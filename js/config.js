// Public configuration only. Set the HTTPS API address here before Firebase deployment.
// An empty string uses the same origin when Express serves the frontend.
window.APP_CONFIG = {
  API_BASE_URL: 'http://localhost:3001',
  ...window.APP_CONFIG
};
