local typedefs = require "kong.db.schema.typedefs"

return {
  name = "oidc-jwt-auth",
  fields = {
    { consumer = typedefs.no_consumer },
    { protocols = typedefs.protocols_http },
    { config = {
        type = "record",
        fields = {
          { require_token = { type = "boolean", required = true, default = true }, },
          { expected_issuer = { type = "string", required = true }, },
          { expected_audience = { type = "string", required = true }, },
          { header_names = {
              type = "set",
              required = true,
              elements = { type = "string" },
              default = { "authorization" },
          }, },
          { query_param_names = {
              type = "set",
              required = true,
              elements = { type = "string" },
              default = { "token" },
          }, },
          { clock_skew_seconds = { type = "number", required = true, default = 30 }, },
          { discovery_ttl_seconds = { type = "number", required = true, default = 300 }, },
          { jwks_ttl_seconds = { type = "number", required = true, default = 300 }, },
        },
      },
    },
  },
}
