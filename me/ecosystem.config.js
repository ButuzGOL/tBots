module.exports = {
  apps: [{
    name: 'me', script: 'index.js',
    env: { 'NODE_ENV': 'production' },
    cron: '0 18 * * *'
  }]
};