/**
 * Admin commands, run on the server:
 *   node server/cli.js list-users
 *   node server/cli.js reset-password <username-or-email> [new-password]
 *   node server/cli.js create-user <username-or-email> [password]
 *   node server/cli.js delete-user <username-or-email>
 * Without a password, a random temporary one is generated and printed.
 */
import { randomBytes } from 'node:crypto';
import { db, findUserByIdentifier, createUser, usernameTaken } from './db.js';
import { hashPassword, passwordProblem } from './auth.js';

const [command, who, given] = process.argv.slice(2);
const tempPassword = () => randomBytes(9).toString('base64url');

function die(msg) {
  console.error(msg);
  process.exit(1);
}

switch (command) {
  case 'list-users': {
    const rows = db.prepare('SELECT username, email, name, password_hash IS NOT NULL AS pw, oidc_subject IS NOT NULL AS sso, created_at FROM users ORDER BY created_at').all();
    if (!rows.length) console.log('No accounts yet.');
    for (const r of rows) {
      const how = [r.pw ? 'password' : null, r.sso ? 'OIDC' : null].filter(Boolean).join(' + ') || 'no sign-in method';
      console.log(`${r.username}${r.email && r.email !== r.username ? ` <${r.email}>` : ''}${r.name ? ` (${r.name})` : ''} — ${how}, created ${r.created_at.slice(0, 10)}`);
    }
    break;
  }
  case 'reset-password': {
    if (!who) die('Usage: reset-password <username-or-email> [new-password]');
    const user = findUserByIdentifier(who);
    if (!user) die(`No account called “${who}”.`);
    const password = given || tempPassword();
    const problem = passwordProblem(password);
    if (problem) die(problem);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    console.log(`Password for ${user.username} reset${given ? '.' : ` to: ${password}`}`);
    console.log('They have been signed out everywhere and can change it from the account menu.');
    break;
  }
  case 'create-user': {
    if (!who) die('Usage: create-user <username-or-email> [password]');
    if (usernameTaken(who)) die(`“${who}” is already taken.`);
    const password = given || tempPassword();
    const problem = passwordProblem(password);
    if (problem) die(problem);
    createUser({ username: who, email: who.includes('@') ? who : null, passwordHash: await hashPassword(password) });
    console.log(`Created ${who}${given ? '.' : ` with temporary password: ${password}`}`);
    break;
  }
  case 'delete-user': {
    if (!who) die('Usage: delete-user <username-or-email>');
    const user = findUserByIdentifier(who);
    if (!user) die(`No account called “${who}”.`);
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    console.log(`Deleted ${user.username} and all their lists and tasks.`);
    break;
  }
  default:
    console.log('Commands: list-users | reset-password <user> [password] | create-user <user> [password] | delete-user <user>');
}
db.close();
