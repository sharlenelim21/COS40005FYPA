// An admin made with the built-in default password (because ADMIN_PASS was missing at its first start) must take
// the password this PC was given (ADMIN_PASS, shown in the installer's login note) at a later start.
import * as bcrypt from "bcrypt";
import { BUILT_IN_ADMIN_PASSWORD, replaceDefaultAdminPassword } from "../src/services/admin_password";

const notePassword = "Note-Pass-123!";

async function adminWith(password: string, username = "admin") {
  return { username, password: await bcrypt.hash(password, 4), save: jest.fn().mockResolvedValue(undefined) };
}

describe("replaceDefaultAdminPassword", () => {
  it("replaces the built-in default with ADMIN_PASS", async () => {
    const admin = await adminWith(BUILT_IN_ADMIN_PASSWORD);
    expect(await replaceDefaultAdminPassword(admin, notePassword)).toBe(true);
    expect(await bcrypt.compare(notePassword, admin.password)).toBe(true);
    expect(admin.save).toHaveBeenCalledTimes(1);
  });

  it("keeps a password the admin chose", async () => {
    const admin = await adminWith("Chosen-By-Admin-1!");
    const before = admin.password;
    expect(await replaceDefaultAdminPassword(admin, notePassword)).toBe(false);
    expect(admin.password).toBe(before);
    expect(admin.save).not.toHaveBeenCalled();
  });

  it("does nothing without ADMIN_PASS (a developer copy)", async () => {
    const admin = await adminWith(BUILT_IN_ADMIN_PASSWORD);
    expect(await replaceDefaultAdminPassword(admin, undefined)).toBe(false);
    expect(await replaceDefaultAdminPassword(admin, "")).toBe(false);
    expect(admin.save).not.toHaveBeenCalled();
  });

  it("does nothing when ADMIN_PASS is the built-in default itself", async () => {
    const admin = await adminWith(BUILT_IN_ADMIN_PASSWORD);
    expect(await replaceDefaultAdminPassword(admin, BUILT_IN_ADMIN_PASSWORD)).toBe(false);
    expect(admin.save).not.toHaveBeenCalled();
  });

  it("leaves admins other than the default 'admin' account alone", async () => {
    const admin = await adminWith(BUILT_IN_ADMIN_PASSWORD, "dr-lee");
    expect(await replaceDefaultAdminPassword(admin, notePassword)).toBe(false);
    expect(admin.save).not.toHaveBeenCalled();
  });
});
