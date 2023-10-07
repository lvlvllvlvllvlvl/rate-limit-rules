import axios from "axios";
import { describe, expect, it } from "vitest";
import { AxiosRateLimiter } from "../src/rate-limiters/axios-adapter";

describe("axios adapter", () => {
  it("fetches data from the api", async () => {
    const { request: adapter } = new AxiosRateLimiter();
    const api = axios.create({ adapter: (conf) => adapter(conf) });

    const result = await api(
      "https://www.pathofexile.com/character-window/get-passive-skills?accountName=lV_lS&realm=pc&character=sanplum",
      {
        headers: {
          "User-Agent": "OAuth rate-limit-rules/1.0.0 (contact: https://github.com/lvlvllvlvllvlvl/rate-limit-rules)",
        },
      }
    );

    expect(result.data).toHaveProperty("hashes");
  });
});
