const scanner = require('sonarqube-scanner').default;

scanner(
  {
    serverUrl: 'https://sonarcloud.io',
    token: '533031695f8f6acb758d165e1a24148d05da94db',
    options: {
      'sonar.projectKey': 'BrewHubPHL_bot',
      'sonar.organization': 'brewhubphl',
      'sonar.sources': '.',
      'sonar.exclusions': 'node_modules/**,coverage/**,dist/**,build/**'
    }
  },
  () => process.exit()
);
