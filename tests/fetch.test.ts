import { describe, expect, it } from "vitest";
import { FetchRateLimiter } from "../src/rate-limiters/fetch";

describe(
  "fetch wrapper",
  () => {
    it("fetches data from the api", async () => {
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
  },
  { timeout: 30000 }
);
