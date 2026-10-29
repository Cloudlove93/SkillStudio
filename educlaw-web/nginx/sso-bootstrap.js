(function () {
  var params = new URLSearchParams(window.location.hash.slice(1));
  var token = params.get('token');
  if (!token) return;

  localStorage.setItem('access_token', token);
  localStorage.setItem('educlaw-token', token);
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
})();
