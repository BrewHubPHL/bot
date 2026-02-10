// Public config endpoint for client-side Square SDK
// Only exposes values that are safe to be public

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=300', // 5 min cache
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      squareAppId: process.env.SQUARE_PRODUCTION_APPLICATION_ID,
      squareLocationId: process.env.SQUARE_LOCATION_ID,
    }),
  };
};
