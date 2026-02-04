exports.handler = async (event) => {
  // 1. Security Check: Verify the Internal Sync Secret
  const incomingSecret = event.headers['x-brewhub-secret'];
  const localSecret = process.env.INTERNAL_SYNC_SECRET;

  if (!incomingSecret || incomingSecret !== localSecret) {
    console.error("Unauthorized attempt to access BrewHub Webhook Router.");
    return { 
      statusCode: 401, 
      body: JSON.stringify({ error: "Unauthorized" }) 
    };
  }

  // 2. Parse the payload from Supabase
  const payload = JSON.parse(event.body || '{}');
  const { type, record, old_record } = payload;

  console.log(`Processing ${type} for order: ${record?.id}`);

  let targetFunction = '';

  /**
   * ROUTING LOGIC:
   * - If a NEW order is created, sync it to the Square Sandbox.
   * - If an EXISTING order is updated to 'paid', trigger the voice announcement.
   */
  if (type === 'INSERT') {
    targetFunction = 'square-sync';
  } else if (
    type === 'UPDATE' && 
    record.status === 'paid' && 
    old_record?.status !== 'paid'
  ) {
    targetFunction = 'order-announcer';
  }

  // 3. Forward the request to the appropriate service
  if (targetFunction) {
    try {
      // Use localhost:8888 for local dev, or the deployed URL
      const baseUrl = process.env.URL || 'http://localhost:8888';
      
      await fetch(`${baseUrl}/.netlify/functions/${targetFunction}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ record })
      });

      return { 
        statusCode: 200, 
        body: JSON.stringify({ message: `Routed to ${targetFunction}` }) 
      };
    } catch (err) {
      console.error(`Routing error to ${targetFunction}:`, err);
      return { statusCode: 500, body: "Internal Routing Error" };
    }
  }

  // Default response if no action is required
  return { 
    statusCode: 200, 
    body: JSON.stringify({ message: "No action required for this event." }) 
  };
};
