local cjson = require "kong.tools.cjson"
local http = require "resty.http"
local jwt_parser = require "kong.plugins.jwt.jwt_parser"
local kong_meta = require "kong.meta"
local openssl_pkey = require "resty.openssl.pkey"
local openssl_digest = require "resty.openssl.digest"

local ipairs = ipairs
local ngx_time = ngx.time

local OidcJwtAuth = {
  VERSION = kong_meta.version,
  PRIORITY = 1455,
}

local function trim_trailing_slash(value)
  return (value or ""):gsub("/+$", "")
end

local function clear_auth_context(query_param_names)
  kong.service.request.clear_header("Authorization")
  kong.service.request.clear_header("X-User-Id")
  kong.service.request.clear_header("X-User-Username")
  kong.service.request.clear_header("X-User-Email")

  local query_args = kong.request.get_query()
  local changed = false
  for _, name in ipairs(query_param_names) do
    if query_args[name] ~= nil then
      query_args[name] = nil
      changed = true
    end
  end

  if changed then
    kong.service.request.set_query(query_args)
  end
end

local function extract_token(conf)
  local headers = kong.request.get_headers()
  for _, name in ipairs(conf.header_names) do
    local header = headers[name]
    if header then
      if type(header) == "table" then
        header = header[1]
      end
      if type(header) == "string" then
        local token = header:match("^[Bb]earer%s+(.+)$")
        if token and token ~= "" then
          return token
        end
      end
    end
  end

  local query_args = kong.request.get_query()
  for _, name in ipairs(conf.query_param_names) do
    local token = query_args[name]
    if type(token) == "string" and token ~= "" then
      return token
    end
  end

  return nil
end

local function fetch_json(url)
  local client = http.new()
  client:set_timeouts(2000, 2000, 5000)

  local res, err = client:request_uri(url, {
    method = "GET",
    headers = { Accept = "application/json" },
    keepalive = true,
  })

  if not res then
    return nil, "request failed: " .. tostring(err)
  end

  if res.status ~= 200 then
    return nil, "unexpected status " .. tostring(res.status)
  end

  return res.body
end

local function get_discovery(conf)
  local cache_key = "oidc-jwt-auth:discovery:" .. conf.expected_issuer
  return kong.cache:get(cache_key, { ttl = conf.discovery_ttl_seconds }, function()
    local body, err = fetch_json(trim_trailing_slash(conf.expected_issuer) .. "/.well-known/openid-configuration")
    if not body then
      return nil, err
    end

    local discovery, decode_err = cjson.decode_with_array_mt(body)
    if decode_err or type(discovery) ~= "table" then
      return nil, "failed to decode discovery document"
    end

    if type(discovery.jwks_uri) ~= "string" or discovery.jwks_uri == "" then
      return nil, "discovery document missing jwks_uri"
    end

    return discovery
  end)
end

local function get_jwks(conf, jwks_uri)
  local cache_key = "oidc-jwt-auth:jwks:" .. jwks_uri
  return kong.cache:get(cache_key, { ttl = conf.jwks_ttl_seconds }, function()
    local body, err = fetch_json(jwks_uri)
    if not body then
      return nil, err
    end

    local jwks, decode_err = cjson.decode_with_array_mt(body)
    if decode_err or type(jwks) ~= "table" or type(jwks.keys) ~= "table" then
      return nil, "failed to decode JWKS"
    end

    return jwks
  end)
end

local function verify_claims(conf, claims)
  local now = ngx_time()
  if trim_trailing_slash(claims.iss) ~= trim_trailing_slash(conf.expected_issuer) then
    return nil, "issuer mismatch"
  end

  local aud_ok = false
  if type(claims.aud) == "string" then
    aud_ok = claims.aud == conf.expected_audience
  elseif type(claims.aud) == "table" then
    for _, aud in ipairs(claims.aud) do
      if aud == conf.expected_audience then
        aud_ok = true
        break
      end
    end
  end

  if not aud_ok and (claims.azp == conf.expected_audience or claims.client_id == conf.expected_audience) then
    aud_ok = true
  end

  if not aud_ok then
    return nil, "audience mismatch"
  end

  if type(claims.exp) ~= "number" or claims.exp + conf.clock_skew_seconds < now then
    return nil, "token expired"
  end

  if type(claims.nbf) == "number" and claims.nbf - conf.clock_skew_seconds > now then
    return nil, "token not yet valid"
  end

  return true
end

local function verify_signature(jwt, jwks)
  if jwt.header.alg ~= "RS256" then
    return nil, "unsupported JWT alg"
  end

  local candidates = {}
  for _, jwk in ipairs(jwks.keys) do
    if type(jwk) == "table" and jwk.kty == "RSA" and (not jwt.header.kid or jwk.kid == jwt.header.kid) then
      candidates[#candidates + 1] = jwk
    end
  end

  if #candidates == 0 then
    return nil, "no matching JWK found"
  end

  local signing_input = jwt.header_64 .. "." .. jwt.claims_64
  local last_err
  for _, jwk in ipairs(candidates) do
    local key_json = cjson.encode(jwk)
    local public_key, key_err = openssl_pkey.new(key_json, { format = "JWK" })
    if public_key then
      local digest = openssl_digest.new("sha256")
      digest:update(signing_input)
      local ok, verify_err = public_key:verify(jwt.signature, digest)
      if ok then
        return true
      end
      last_err = verify_err or "signature verification failed"
    else
      last_err = key_err or "failed to construct public key"
    end
  end

  return nil, last_err or "signature verification failed"
end

local function inject_headers(claims)
  if type(claims.sub) ~= "string" or claims.sub == "" then
    return nil, "JWT missing subject claim"
  end

  kong.service.request.set_header("X-User-Id", claims.sub)

  local username = claims.preferred_username or claims.email or claims.sub
  if type(username) == "string" and username ~= "" then
    kong.service.request.set_header("X-User-Username", username)
  end

  if type(claims.email) == "string" and claims.email ~= "" then
    kong.service.request.set_header("X-User-Email", claims.email)
  end

  return true
end

function OidcJwtAuth:access(conf)
  kong.log.err("[oidc-jwt-auth] access() called, path=", kong.request.get_path())
  local token = extract_token(conf)
  kong.log.info("[oidc-jwt-auth] token extracted: ", token and ("len=" .. #token) or "nil")
  clear_auth_context(conf.query_param_names)
  if not token then
    kong.log.info("[oidc-jwt-auth] no token, require_token=", conf.require_token)
    if conf.require_token then
      return kong.response.exit(401, { error = "Authentication required" })
    end
    return
  end

  local jwt, err = jwt_parser:new(token)
  if err then
    kong.log.warn("[oidc-jwt-auth] JWT parse rejected: ", err)
    return kong.response.exit(401, { error = "Invalid token" })
  end
  kong.log.info("[oidc-jwt-auth] JWT parsed ok, iss=", jwt.claims.iss, " sub=", jwt.claims.sub)

  local claims_ok, claims_err = verify_claims(conf, jwt.claims)
  if not claims_ok then
    kong.log.warn("[oidc-jwt-auth] JWT claims rejected: ", claims_err, " expected_iss=", conf.expected_issuer, " expected_aud=", conf.expected_audience)
    return kong.response.exit(401, { error = "Invalid token" })
  end
  kong.log.info("[oidc-jwt-auth] JWT claims ok")

  local discovery, discovery_err = get_discovery(conf)
  if not discovery then
    kong.log.err("OIDC discovery failed: ", discovery_err)
    return kong.response.exit(500, { error = "Authentication upstream unavailable" })
  end

  local jwks, jwks_err = get_jwks(conf, discovery.jwks_uri)
  if not jwks then
    kong.log.err("JWKS fetch failed: ", jwks_err)
    return kong.response.exit(500, { error = "Authentication upstream unavailable" })
  end

  local signature_ok, signature_err = verify_signature(jwt, jwks)
  if not signature_ok then
    kong.log.warn("[oidc-jwt-auth] JWT signature rejected: ", signature_err)
    return kong.response.exit(401, { error = "Invalid token" })
  end
  kong.log.info("[oidc-jwt-auth] JWT signature ok")

  local inject_ok, inject_err = inject_headers(jwt.claims)
  if not inject_ok then
    kong.log.warn("[oidc-jwt-auth] header inject failed: ", inject_err)
    return kong.response.exit(401, { error = "Invalid token" })
  end
  kong.log.info("[oidc-jwt-auth] headers injected for sub=", jwt.claims.sub)
end

return OidcJwtAuth
