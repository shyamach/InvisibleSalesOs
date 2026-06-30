// CloudAuth.js
import pkg from 'whatsapp-web.js';
const { RemoteAuth } = pkg;
import { supabase } from './supabaseClient.js';

export class SupabaseStore {
    constructor() {
        this.sessionTable = 'whatsapp_sessions';
    }

    // Helper to ensure clientId is a clean string
    _getClientId(clientId) {
        if (typeof clientId === 'object') {
            return clientId.clientId || clientId.id || 'default_client';
        }
        return clientId;
    }

    async sessionExists(clientId) {
        const id = this._getClientId(clientId);
        const { data, error } = await supabase
            .from(this.sessionTable)
            .select('id')
            .eq('tenant_id', id)
            .single();
        
        return !!data;
    }

    async save(clientId, sessionData) {
        const id = this._getClientId(clientId);
        
        // Defensive check: don't save empty session data
        if (!sessionData) {
            console.log("☁️ [CloudAuth]: Skipping save, session data empty.");
            return;
        }

        try {
            console.log(`☁️ [CloudAuth]: Syncing session for: ${id}...`);
            
            const { error } = await supabase
                .from(this.sessionTable)
                .upsert({ 
                    tenant_id: id, 
                    session_data: sessionData,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'tenant_id' });

            if (error) {
                console.error("❌ Session Save Error:", error);
            } else {
                console.log("✅ Session data successfully persisted.");
            }
        } catch (err) {
            console.error("💥 Session Save Exception:", err);
        }
    }

    async extract(clientId) {
        const id = this._getClientId(clientId);
        try {
            const { data, error } = await supabase
                .from(this.sessionTable)
                .select('session_data')
                .eq('tenant_id', id)
                .single();
            
            return data ? data.session_data : null;
        } catch (err) {
            console.error("💥 Session Extract Exception:", err);
            return null;
        }
    }

    async delete(clientId) {
        const id = this._getClientId(clientId);
        await supabase.from(this.sessionTable).delete().eq('tenant_id', id);
    }
}