// File: src/services/admin_password.ts
// Description: Gives the default "admin" account the password this PC was set up with.
import * as bcrypt from "bcrypt";

// Used when ADMIN_PASS is not set (developer copies). Follows the password validation rules.
export const BUILT_IN_ADMIN_PASSWORD = "P@ssw0rd123!";

interface AdminAccount {
  username: string;
  password: string;
  save(): Promise<unknown>;
}

/**
 * The admin account is created only once, on the first start. If ADMIN_PASS was missing then, the account got the
 * built-in default, and the password in the installer's login note (ADMIN_PASS) never works. This gives such an
 * account ADMIN_PASS. A password anyone has chosen is never touched, nor are admin accounts other than "admin".
 *
 * @returns true when the password was replaced.
 */
export async function replaceDefaultAdminPassword(admin: AdminAccount, adminPass: string | undefined): Promise<boolean> {
  if (!adminPass || adminPass === BUILT_IN_ADMIN_PASSWORD || admin.username !== "admin") return false;
  if (!(await bcrypt.compare(BUILT_IN_ADMIN_PASSWORD, admin.password))) return false;
  admin.password = await bcrypt.hash(adminPass, 10);
  await admin.save();
  return true;
}
