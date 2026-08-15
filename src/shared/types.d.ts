export type QueryStatus = 'found' | 'not_found' | 'error';
export type Platform = 'discogs' | 'ebay' | 'kojima' | 'hmv' | 'yahoo' | 'cdjapan' | 'tower';
export interface QueryResult {
    platform: Platform;
    name: string | null;
    artist: string | null;
    priceMin: number | null;
    priceMax: number | null;
    coverUrl: string | null;
    link: string | null;
    status: QueryStatus;
    error?: string;
}
export interface Settings {
    discogsToken?: string;
    ebayClientId?: string;
    ebayClientSecret?: string;
}
export interface BatchQueryProgress {
    event: string;
    catalogNumber: string;
    platform: string;
    status: 'loading' | 'complete' | 'error' | 'not_found';
}
export interface BatchQueryResult {
    catalogNumber: string;
    results: QueryResult[];
}
export interface ThrottleStatus {
    domains: Record<string, {
        pendingRequests: number;
        active: boolean;
        backoffAttempt: number | null;
        nextBackoffDelay: number | null;
    }>;
}
