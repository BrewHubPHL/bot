/**
 * Development Configuration
 * Controls which functions run locally vs. are proxied to Netlify preview
 */

module.exports = {
  // Functions that consume heavy RAM (AI SDKs, large dependencies)
  // These will be proxied to Netlify preview when NETLIFY_PREVIEW_URL is set
  offloadFunctions: [
    'claude-chat',      // Claude AI SDK
    'marketing-bot',    // Google AI + Facebook SDK  
    'get-voice-session', // ElevenLabs
    'text-to-speech'    // ElevenLabs
  ],

  // To test a heavy function locally, comment it out above
  // Example: // 'claude-chat',

  // Default proxy target (env var NETLIFY_PREVIEW_URL overrides this)
  previewUrl: 'https://brewhubbot.netlify.app'
};
