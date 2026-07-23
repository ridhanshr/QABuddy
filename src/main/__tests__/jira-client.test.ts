import { describe, expect, it } from "vitest";
import { stripXrayBulletPrefixes } from "../services/jira/jira-client";

describe("stripXrayBulletPrefixes", () => {
  it("removes Xray bullet and numbered-list prefixes", () => {
    expect(
      stripXrayBulletPrefixes(
        "- 1. Buka web LOS\n- 2. Lakukan Pengajuan hingga selesai di LOS"
      )
    ).toBe("Buka web LOS\nLakukan Pengajuan hingga selesai di LOS");
  });

  it("removes ordered-list prefixes without bullets", () => {
    expect(stripXrayBulletPrefixes("1. Buka halaman login\n2. Masukkan kredensial"))
      .toBe("Buka halaman login\nMasukkan kredensial");
  });

  it("removes bullets from unnumbered steps", () => {
    expect(stripXrayBulletPrefixes("- Login Way4Desktop\n- Login dengan Credential yang Benar"))
      .toBe("Login Way4Desktop\nLogin dengan Credential yang Benar");
  });
});
