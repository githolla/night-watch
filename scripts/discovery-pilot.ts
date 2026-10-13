import { DiscoveryCollector } from "../src/lib/discovery/providers.ts";
import { defaultConfig } from "../src/lib/discovery/domain.ts";
const collector = new DiscoveryCollector(AbortSignal.timeout(90000));
for (const source of defaultConfig.sources.filter((source) => source.provider !== "sam")) {
  const result = await collector.collect(source, 3, Date.now(), defaultConfig.keywords);
  console.log(JSON.stringify({ source: source.label, coverage: result.coverage, examples: result.items.map((item) => ({ title: item.title, url: item.url, partial: item.partial })) }));
}
