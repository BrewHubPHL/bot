const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async (event) => {
  // 1. Apify sends a POST when the run succeeds
  const { resource } = JSON.parse(event.body || '{}');
  const datasetId = resource?.defaultDatasetId;

  if (!datasetId) return { statusCode: 400, body: 'Missing Dataset ID' };

  try {
    // 2. Fetch the actual items from the Apify Dataset
    const apifyUrl = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${process.env.APIFY_TOKEN}`;
    const response = await fetch(apifyUrl);
    const items = await response.json();

    console.log(`[APIFY] Received ${items.length} posts, filtering for >50 likes...`);

    // 3. Filter and map the data to our Supabase schema
    const cleanItems = items
      .filter(post => post.likesCount > 20)
      .map(post => ({
        id: post.url,
        username: post.ownerUsername,
        caption: post.caption,
        image_url: post.displayUrl,
        likes: post.likesCount,
        posted_at: post.timestamp
      }));
    
    console.log(`[APIFY] ${cleanItems.length} posts passed the filter.`);

    // 4. "Upsert" ensures we update likes but don't create double rows
    const { error } = await supabase
      .from('local_mentions')
      .upsert(cleanItems, { onConflict: 'id' });

    if (error) throw error;

    return { statusCode: 200, body: `Synced ${items.length} posts.` };
  } catch (err) {
    console.error('Sync Error:', err);
    return { statusCode: 500, body: 'Sync Failed' };
  }
};