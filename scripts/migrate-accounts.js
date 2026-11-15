import {createAccounts} from '../lib/accounts.js';
if(!process.env.DATABASE_URL||!process.env.BETTER_AUTH_SECRET||!process.env.BETTER_AUTH_URL)throw new Error('Set DATABASE_URL, BETTER_AUTH_SECRET and BETTER_AUTH_URL before migration.');
const accounts=await createAccounts({databaseURL:process.env.DATABASE_URL,secret:process.env.BETTER_AUTH_SECRET,baseURL:process.env.BETTER_AUTH_URL});
console.log('Account and room schema ready.');await accounts.close();
