module.exports = {
  appId: 'com.streambooru.app',
  appName: 'StreamBooru',
  webDir: 'renderer',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    CapacitorHttp: {
      enabled: true
    }
  }
};
