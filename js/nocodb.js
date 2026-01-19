export class NocoDBClient {
    constructor(tableUrl, token) {
        // Ensure no trailing slash
        this.tableUrl = tableUrl.replace(/\/$/, "");
        this.token = token;
    }

    async _request(method, endpoint = "", body = null) {
        // endpoint can be empty for base URL, or "/{id}"
        const url = `${this.tableUrl}${endpoint}`;
        const headers = {
            "xc-token": this.token,
            "Content-Type": "application/json"
        };
        
        const options = {
            method,
            headers
        };

        if (body) {
            options.body = JSON.stringify(body);
        }

        const response = await fetch(url, options);

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`API Error ${response.status}: ${text}`);
        }

        // DELETE usually returns empty or minimal json
        if (method === 'DELETE') return true;

        return response.json();
    }

    async list(params = {}) {
        // Build query string
        const usp = new URLSearchParams();
        usp.append('limit', '100'); // Reasonable default for shopping list
        // usp.append('sort', '-CreatedAt'); // Removed to avoid 400 error on V3 (client sorts anyway)
        
        // Add extra params if needed
        for (const [key, value] of Object.entries(params)) {
            usp.append(key, value);
        }

        // We use the base URL for listing
        // Note: NocoDB usually puts query params on the base table URL for listing
        const url = `${this.tableUrl}?${usp.toString()}`;
        
        const headers = {
            "xc-token": this.token,
            "Content-Type": "application/json"
        };
        
        const response = await fetch(url, { headers });
        if (!response.ok) throw new Error(`List failed: ${response.status}`);
        return response.json();
    }

    async create(data) {
        // V3 requires parameters inside 'fields', index 0 allows flat object or array? 
        // Safer to use { fields: data } for single record creation
        return this._request("POST", "", { fields: data });
    }

    async update(id, data) {
        return this._request("PATCH", "", { id: id, fields: data });
    }

    async delete(id) {
        return this._request("DELETE", "", { id: id });
    }
}
