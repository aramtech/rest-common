import AsyncLock from "async-lock";
import fs from "fs";
import path from "path";
import URL from "url";
import { ArgumentsType } from "vitest";
const axios = (await import("axios")).default;

const load_json = (json_path: fs.PathOrFileDescriptor) => {
    let json = fs.readFileSync(json_path, "utf-8");
    json = json
        .split("\n")
        .filter((line) => {
            return !line.match(/^\s*?\/\//);
        })
        .join("\n");
    json = json.replaceAll(/\/\*(.|\n)*?\*\//g, "");
    json = json.replaceAll(/\,((\s|\n)*?(?:\}|\]))/g, "$1");
    json = JSON.parse(json);
    return json;
};

const load_env = (): typeof import("$/server/env.json") => {
    const env_path = path.join(src_path, "env.json");
    return load_json(env_path) as any;
};

type BasicTypes = boolean | number | string | null;
export type RecursiveReadable =
    | BasicTypes
    | {
          [key: string]: null | RecursiveReadable;
      }
    | RecursiveReadable[];
export type JSONObject = {
    [key: string]: RecursiveReadable;
};

export type Merge<T, U> = T & Omit<U, keyof T>;

export type OmitFunctions<T> = Pick<
    T,
    {
        [K in keyof T]: T[K] extends Function ? never : K;
    }[keyof T]
>;

export type NestedType<EndType> = EndType | ListNestedType<EndType>;
type ListNestedType<EndType> = NestedType<EndType>[];

export type ShallowObject = {
    [key: string]: BasicTypes | undefined;
};

export const compare_shallow_record = (a: ShallowObject, b: ShallowObject) => {
    const a_entries = Object.entries(a);
    const b_entries = Object.entries(b);
    if (a_entries.length != b_entries.length) {
        return false;
    }
    for (let i = 0; i < a_entries.length; i++) {
        const a_entry = a_entries[i];
        const b_entry = b_entries[i];
        if (a_entry[0] != b_entry[0] || a_entry[1] != b_entry[1]) {
            return false;
        }
    }

    return true;
};

export const isBun = () => {
    try {
        // @ts-ignore
        return !!Bun;
    } catch (error) {
        return false;
    }
};

export const surface_nested_type = <EndType>(nested: NestedType<EndType>[], __root = true, __list: EndType[] = []) => {
    if (__root) {
        __list = [];
    }

    for (const item of nested) {
        if (Array.isArray(item)) {
            surface_nested_type(item, false, __list);
        } else {
            __list.push(item);
        }
    }

    return __list;
};
export const resolve_ts = (path: string) => {
    if (path.endsWith(".ts")) {
        path = path.replace(/\.ts$/, ".js");
    }
    return path;
};

const app_path = path.resolve(path.join(path.dirname(URL.fileURLToPath(import.meta.url)), "../../../."));
const src_path = path.resolve(path.join(path.dirname(URL.fileURLToPath(import.meta.url)), "../../."));
const env = load_env();

const lock = new AsyncLock({ maxExecutionTime: 5e3 });

export const lock_method = function <T extends (...args: any[]) => any>(
    method: T,
    {
        lock_name,
        lock_timeout = 1e4,
    }: {
        lock_name: string;
        lock_timeout?: number;
    },
): (...args: ArgumentsType<T>) => Promise<ReturnType<T>> {
    const originalMethod = method;
    return async function (...args: any[]) {
        return new Promise(async (resolve, reject) => {
            try {
                await lock.acquire(
                    lock_name,
                    async () => {
                        try {
                            return resolve(await originalMethod(...args));
                        } catch (error) {
                            reject(error);
                        }
                    },
                    {
                        timeout: lock_timeout,
                    },
                );
            } catch (error) {
                reject(error);
            }
        });
    };
};

export function resolve_path(relative_path, base_url) {
    return URL.fileURLToPath(new URL.URL(relative_path, base_url));
}

export const relative_to_absolute_path = resolve_path;

export function create_path_resolver(base_url: string) {
    function resolve(input_path: string): string {
        if (input_path.startsWith(`${env.basetag_symbol}/`)) {
            return path.join(app_path, input_path.slice(2));
        } else {
            return URL.fileURLToPath(new URL.URL(input_path, base_url));
        }
    }
    return resolve;
}

export async function downloadFile(url: string, body: any, output_path: string): Promise<boolean> {
    const writer = fs.createWriteStream(output_path);

    const ax = axios as any;

    return ax({
        method: "post",
        url: url,
        data: body,
        responseType: "stream",
    }).then((response) => {
        return new Promise((resolve, reject): any => {
            response.data.pipe(writer);
            let error: any = null;
            writer.on("error", (err) => {
                error = err;
                writer.close();
                reject(err);
            });
            writer.on("close", () => {
                if (!error) {
                    resolve(true);
                }
                //no need to call the reject here, as it will have been called in the
                //'error' stream;
            });
        });
    });
}

export function clip(text: string, max_length: number): string {
    if (!text) {
        return "";
    }
    if (text.length > max_length) {
        return `${text.slice(0, max_length - 3)}...`;
    } else {
        return text;
    }
}

/**
 *
 * recursive select utility
 *
 * @param {String|Array<string>} selector a dot seperated names of parameters or Array of parameters to select item from given object
 * @param {Object} obj Object to select from
 * @returns {*} Selected item or undefined
 *
 */
export function recursive_select(selector: string | Array<string>, obj: object): any {
    if (typeof selector == "string") {
        selector = selector.split(".").filter((s) => !!s);
    }

    if (!selector || !selector.length) {
        return obj;
    }
    try {
        return recursive_select(selector.slice(1), obj[selector[0]]);
    } catch (error) {
        // console.log("Recursive select error", error);
        return undefined;
    }
}

function pad_id(id: string | number): string {
    return "#" + String(id).padStart(10, "0");
}
export { pad_id };

function fixed(value: string | number | null, n = 2) {
    return Number(Number(value).toFixed(n));
}

const math = {
    fixed,
    ceil: fixed,
    min: (arr: Array<number>): number => Math.min(...arr.filter((el) => !Number.isNaN(Number(el)))),
    max: (arr: Array<number>): number => Math.max(...arr.filter((el) => !Number.isNaN(Number(el)))),
};
export { math };

function cap(str: string) {
    return str.replaceAll(/\b\w+\b/gi, (match) => {
        const string = match;
        return string.charAt(0).toUpperCase() + string.slice(1);
    });
}
export { cap };

const padStart = (string: string, targetLength: number, padString: string): string => {
    targetLength = targetLength >> 0;
    string = String(string);
    padString = String(padString);

    if (string.length > targetLength) {
        return String(string);
    }

    targetLength = targetLength - string.length;

    if (targetLength > padString.length) {
        padString += padString.repeat(targetLength / padString.length);
    }

    return padString.slice(0, targetLength) + String(string);
};

export function validate_approximation(
    value: number | undefined | null,
    source_value: number | undefined | null = null,
    min_approximation: number | undefined | null = 0.02,
): number {
    if (source_value) {
        if (source_value - Number(value) < -0.1) {
            throw {
                status_code: env.response.status_codes.action_not_authorized,
                error: {
                    msg: "invalid transaction, treasury total goes below zero",
                },
            };
        }
        if (Math.abs(source_value - Number(value)) < Number(min_approximation)) {
            value = source_value;
        }
    } else {
        if (Number(value) < -0.1) {
            throw {
                status_code: env.response.status_codes.action_not_authorized,
                error: {
                    msg: "invalid transaction, treasury total goes below zero",
                },
            };
        }
        if (Math.abs(Number(value)) < Number(min_approximation)) {
            value = 0;
        }
    }
    return Number(value);
}

const padDate = (n: string, length = 2) => padStart(n, length, "0");
export { padDate, padStart };
/**
 *
 * @param {Date} date
 * @param {Boolean} getdate
 * @param {Boolean} gettime
 * @returns {String}
 */
export function dash_date_formater(
    date: Date,
    getDate: boolean = true,
    getTime: boolean = true,
    getMilliseconds: boolean = false,
): string {
    if (typeof date == "string") {
        date = new Date(date + " ");
    }

    let return_content: string[] = [];
    if (getDate) {
        const Month = padDate(String(date.getMonth() + 1));
        const DayOfMonth = padDate(String(date.getDate()));
        const FullYear = date.getFullYear();
        return_content.push(`${FullYear}-${Month}-${DayOfMonth}`);
    }
    if (getTime) {
        const Hour = padDate(String(date.getHours()));
        const Minutes = padDate(String(date.getMinutes()));
        const Seconds = padDate(String(date.getSeconds()));
        let time_string = `${Hour}:${Minutes}:${Seconds}`;
        if (getMilliseconds) {
            const Milliseconds = String(date.getMilliseconds());
            time_string += "." + Milliseconds.padEnd(3, "0");
        }
        return_content.push(time_string);
    }
    return return_content.join(" ") + " ";
}

export default {
    cap,
    Object_manipulation: {
        recursive_select: recursive_select,
        rs: recursive_select,

        select_random<T>(arr: T[]): T {
            return arr[Math.floor(arr.length * Math.random())];
        },
    },
    datetime: {
        /**
         * returns mysql timestamp string out of Date object
         * @param {Date} InputDate input date
         * @returns {String}
         */
        date_to_mysqlstring: (InputDate: Date, date_only = false): string => {
            const date = new Date(InputDate);
            date.setUTCHours(date.getUTCHours() + 2);

            let returned;
            if (date_only) {
                returned = date.toISOString().slice(0, 10);
            } else {
                returned = date.toISOString().slice(0, 19).replace("T", " ");
            }
            return returned;
        },
    },
    async sleep(time = 1000): Promise<void> {
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                resolve();
            }, time);
        });
    },

    select_random<T>(arr: T[]): T {
        return arr[Math.floor(arr.length * Math.random())];
    },

    meta_url_to_router_relative_path(route_url: string) {
        const absolute_path = URL.fileURLToPath(route_url);
        const routers_directory_absolute_path = path.join(src_path, env.router.router_directory);
        return path.dirname(absolute_path.slice(routers_directory_absolute_path.length));
    },
    math: math,
};

export const parse_int = (num: number) => {
    if (!num) {
        return undefined;
    }

    const parsed = parseInt(num as any, 10);

    if (Number.isNaN(parsed)) {
        return undefined;
    }

    return parsed;
};

export const trim_slashes = (path: string) =>
    path[path.length - 1] === "/"
        ? path
              .split("/")
              .filter((x) => x)
              .join("/")
        : path;
