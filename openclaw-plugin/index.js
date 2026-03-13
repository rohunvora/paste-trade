import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { TRADE_COMMAND_TOOL, createTradeDispatchTool } from "./index-lib.mjs";

const tradeSlashWrapperPlugin = {
  id: "trade-slash-wrapper",
  name: "Trade Slash Wrapper",
  description: "Instant /trade acknowledgment with isolated background execution and concise chat updates.",
  configSchema: emptyPluginConfigSchema(),
  register(api) {
    api.registerTool((ctx) => createTradeDispatchTool(api, ctx), {
      names: [TRADE_COMMAND_TOOL],
    });
  },
};

export default tradeSlashWrapperPlugin;
