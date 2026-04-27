import router from './src/routes/packages.js';
for (const layer of (router as any).stack) {
  if (layer.route) {
    console.log(Object.keys(layer.route.methods).join(','), layer.route.path);
  }
}
