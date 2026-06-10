import { describe, it, expect } from "vitest";
import { stripRemoteImages, hasRemoteImages } from "@/lib/emailSanitize";

describe("stripRemoteImages", () => {
  it("blanks remote img src but keeps the element (preserves layout)", () => {
    const out = stripRemoteImages(`<img alt="x" src="https://tracker.example/pixel.gif">`);
    expect(out).toContain(`src=""`);
    expect(out).toContain("<img");
    expect(out).not.toContain("tracker.example");
  });

  it("handles both http and https, single or double quotes", () => {
    expect(stripRemoteImages(`<img src='http://a.test/p.png'>`)).toContain(`src=""`);
    expect(stripRemoteImages(`<img src="https://a.test/p.png">`)).toContain(`src=""`);
  });

  it("strips remote srcset", () => {
    const out = stripRemoteImages(`<img src="https://a.test/1.png" srcset="https://a.test/2.png 2x">`);
    expect(out).toContain(`srcset=""`);
    expect(out).not.toContain("2.png");
  });

  it("neutralizes remote background-image in inline styles", () => {
    const out = stripRemoteImages(`<div style="background-image: url('https://a.test/bg.jpg')"></div>`);
    expect(out).toContain("background-image:none");
    expect(out).not.toContain("a.test");
  });

  it("leaves inline data: image URIs untouched", () => {
    const html = `<img src="data:image/png;base64,iVBORw0KGgo=">`;
    expect(stripRemoteImages(html)).toBe(html);
  });

  it("leaves cid: (inline attachment) image URIs untouched", () => {
    const html = `<img src="cid:logo@nexus">`;
    expect(stripRemoteImages(html)).toBe(html);
  });

  it("strips every remote image when several are present", () => {
    const out = stripRemoteImages(
      `<img src="https://a.test/1.png"><p>hi</p><img src="http://b.test/2.png">`
    );
    expect(out).not.toContain("a.test");
    expect(out).not.toContain("b.test");
    expect(out.match(/src=""/g)).toHaveLength(2);
  });

  it("returns plain text unchanged", () => {
    expect(stripRemoteImages("just some text, no images")).toBe("just some text, no images");
  });
});

describe("hasRemoteImages", () => {
  it("detects a remote https image src", () => {
    expect(hasRemoteImages(`<img src="https://a.test/p.png">`)).toBe(true);
  });

  it("detects a remote http image src", () => {
    expect(hasRemoteImages(`<img src="http://a.test/p.png">`)).toBe(true);
  });

  it("returns false for inline data: images", () => {
    expect(hasRemoteImages(`<img src="data:image/png;base64,iVBORw0KGgo=">`)).toBe(false);
  });

  it("returns false for cid: inline attachments", () => {
    expect(hasRemoteImages(`<img src="cid:logo@nexus">`)).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(hasRemoteImages("")).toBe(false);
  });

  it("is consistent with stripRemoteImages: when it reports true, stripping changes the html", () => {
    const html = `<img src="https://a.test/p.png">`;
    expect(hasRemoteImages(html)).toBe(true);
    expect(stripRemoteImages(html)).not.toBe(html);
  });
});
