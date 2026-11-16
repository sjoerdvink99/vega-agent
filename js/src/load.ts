import { loader } from "vega";
import { remember } from "./collections";
import { units } from "./compile";
import type { Data, InlineData, Spec, Views } from "./spec";
import { records } from "./standards/records";
import { validate } from "./validate";

const PROTOCOL = /^[a-z][a-z0-9+.-]*:/i;

function locate(url: string, base: string): string {
  if (!base || PROTOCOL.test(url) || url.startsWith("/")) return url;
  if (PROTOCOL.test(base)) return new URL(url, base).href;
  const parts: string[] = [];
  for (const part of `${base.endsWith("/") ? base : `${base}/`}${url}`.split("/")) {
    const last = parts[parts.length - 1];
    if (part === "..") {
      if (last === undefined || last === "..") parts.push(part);
      else if (last !== "") parts.pop();
    } else if (part !== ".") parts.push(part);
  }
  return parts.join("/");
}

export async function load(spec: Spec, base = ""): Promise<Spec> {
  const checked = validate(spec);
  const fetcher = loader();
  const fetched = new Map<string, Promise<InlineData>>();
  const inline = (data: Data): Promise<InlineData> =>
    "values" in data
      ? Promise.resolve(data)
      : remember(fetched, JSON.stringify(data), async () => ({
          values: records(String(await fetcher.load(locate(data.url, base)))),
          ...(data.format ? { format: data.format } : {}),
        }));
  const resolved = async <S extends object>(item: S): Promise<S> => ("data" in item && item.data ? { ...item, data: await inline(item.data as Data) } : item);
  if ("facet" in checked) return validate(await resolved(checked));
  const views = (await Promise.all(units(checked).map(resolved))) as Views;
  if ("vconcat" in checked) return validate({ ...(await resolved(checked)), vconcat: views });
  if ("hconcat" in checked) return validate({ ...(await resolved(checked)), hconcat: views });
  return validate(views[0]);
}
