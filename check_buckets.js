import { supabase } from './lib/supabase.js';

async function checkBuckets() {
  const { data, error } = await supabase.storage.listBuckets();
  if (error) {
    console.error('Error listing buckets:', error);
    return;
  }
  console.log('Available buckets:', data.map(b => b.name));
}

checkBuckets();
