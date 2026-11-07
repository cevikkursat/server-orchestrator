/** Diğer diller Türkçe kaynakla aynı anahtarları taşımak zorunda */
export type Shape<T> = { [K in keyof T]: T[K] extends string ? string : Shape<T[K]> };
