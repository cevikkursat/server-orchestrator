import type { Shape } from "@panel/shared";
import type { ApiMessages } from "../tr/index.js";
import { errors } from "./errors.js";
import { notify } from "./notify.js";
import { messages } from "./messages.js";

export const en = { errors, notify, messages } satisfies Shape<ApiMessages>;
