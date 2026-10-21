import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const tables = [
  'profiles',
  'addresses',
  'seller_profiles',
  'coupons',
  'products',
  'product_variants',
  'product_images',
  'orders',
  'order_items',
  'delivery_qr_tokens',
  'returns',
  'refunds',
  'coupon_redemptions',
  'announcements',
  'notifications',
  'payouts',
  'transactions',
  'audit_logs',
  'seller_verifications',
  'verification_sessions'
];

async function main() {
  console.log('Inspecting Supabase tables at:', supabaseUrl);
  const results = {};
  for (const table of tables) {
    const { count, data, error } = await supabase.from(table).select('*', { count: 'exact' }).limit(5);
    if (error) {
      console.log(`- ${table}: ERROR (${error.message})`);
      results[table] = { error: error.message };
    } else {
      console.log(`- ${table}: ${count} rows`);
      results[table] = {
        count,
        sampleColumns: data && data.length > 0 ? Object.keys(data[0]) : [],
        sample: data
      };
    }
  }
}

main().catch(console.error);
