if (!process.env.ADMIN_JID)     throw new Error('Missing ADMIN_JID in .env');
if (!process.env.ALLOWED_GROUP) throw new Error('Missing ALLOWED_GROUP in .env');

export const ALLOWED_GROUPS = new Set([process.env.ALLOWED_GROUP]);
export const ADMIN = process.env.ADMIN_JID;