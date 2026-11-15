import {createAccounts} from '../lib/accounts.js';
const email=process.argv[2]?.trim().toLowerCase();
if(!email)throw new Error('Usage: node scripts/promote-admin.js registered-email');
const accounts=await createAccounts({dataDir:process.env.OBJECT_STORIES_DATA||'data/accounts-preview',databaseURL:process.env.DATABASE_URL,secret:process.env.BETTER_AUTH_SECRET});
const users=await accounts.query('UPDATE "user" SET role=$1 WHERE lower(email)=$2 RETURNING id',['admin',email]);
console.log(users.length?'Administrator role assigned.':'No registered user matched.');await accounts.close();
