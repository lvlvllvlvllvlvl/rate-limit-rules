import { FetchRateLimiter } from "../src/fetch";

describe("fetch wrapper", () => {
  it("make request immediately if there is no header function", async () => {
    const { request: fetch } = new FetchRateLimiter();

    const result = await fetch(
      "https://www.pathofexile.com/character-window/get-passive-skills?accountName=lV_lS&realm=pc&character=sanplum",
      {
        headers: {
          "User-Agent": "OAuth rate-limit-rules/1.0.0 (contact: https://github.com/lvlvllvlvllvlvl/rate-limit-rules)",
        },
      }
    );

    expect(await result.json()).toHaveProperty("hashes");
  });
});
