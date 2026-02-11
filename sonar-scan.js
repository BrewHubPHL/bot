const scanner = require('sonarqube-scanner');

const token = process.env.SONAR_TOKEN;

if (!token) {
  console.error('Missing SONAR_TOKEN environment variable.');
  process.exit(1);
}

scanner(
  {
    serverUrl: 'https://sonarcloud.io',
    token,
    options: {
      'sonar.projectKey': 'BrewHubPHL_bot',
      'sonar.organization': 'brewhubphl',
      'sonar.sources': '.',
      'sonar.exclusions': 'node_modules/**,coverage/**,dist/**,build/**'
    }
  },
  () => process.exit()
);