/**
 * INVISIBLE SALES OS - FRONTEND INTERACTION CORE KERNEL
 * Orchestrates view transitions, authentication validation routines, 
 * drag-and-drop media bindings, and dynamic multi-part network ingress.
 */

let selectedFileObject = null;

// ==========================================
// VIEW ROUTING ENGINE MATRIX
// ==========================================
function switchView(targetPanelId) {
    console.log(`📡 Switching active screen view grid to panel: [${targetPanelId}]`);
    
    // Deactivate all viewport panels
    document.querySelectorAll('.view-panel').forEach(panel => {
        panel.classList.remove('active');
    });
    
    // Deactivate all navigation items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });

    // Activate selected elements
    const targetView = document.getElementById(`view-${targetPanelId}`);
    const targetBtn = document.getElementById(`btn-${targetPanelId}`);
    
    if (targetView) targetView.classList.add('active');
    if (targetBtn) targetBtn.classList.add('active');
}

// ==========================================
// CORPORATE ACCESS GATE (AUTHENTICATION)
// ==========================================
function handleAuthAction(event) {
    event.preventDefault();
    const email = document.getElementById('auth-email').value;
    
    console.log(`🔐 Identity key verified. Mapping security token to node: ${email}`);
    document.getElementById('user-display').textContent = email;
    
    // Remove interface visual isolation barrier block
    document.getElementById('auth-overlay').style.display = 'none';
}

function triggerSignOut() {
    console.log('🔓 Disconnecting security keys from global storage structures.');
    document.getElementById('auth-overlay').style.display = 'flex';
}

// ==========================================
// MODULE 1 DRAG & DROP MECHANICS BINDINGS
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('mediaFile');
    const dropZoneText = document.getElementById('dropZoneText');

    if (!dropZone || !fileInput) return;

    // Trigger visual status states on drag maneuvers
    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
        }, false);
    });

    // Process physical element capture drop actions
    dropZone.addEventListener('drop', (e) => {
        const dataTransfer = e.dataTransfer;
        const droppedFiles = dataTransfer.files;
        
        if (droppedFiles.length > 0) {
            fileInput.files = droppedFiles;
            bindSelectedFileAttributes(droppedFiles[0]);
        }
    });

    // Handle normal file browse dialogue clicks
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            bindSelectedFileAttributes(e.target.files[0]);
        }
    });

    function bindSelectedFileAttributes(file) {
        selectedFileObject = file;
        console.log(`📎 Target media asset queued for pipeline processing: ${file.name}`);
        dropZoneText.innerHTML = `📄 <strong style="color: var(--accent);">${file.name}</strong> ready for upload`;
    }
});

// ==========================================
// ENGINE PIPELINE INTEGRATION RUNNER EXEC
// ==========================================
async function runInteractivePipeline() {
    const rawTextInput = document.getElementById('ui-raw-input').value.trim();
    const jsonPane = document.getElementById('ui-json-pane');
    const draftPane = document.getElementById('ui-draft-pane');

    if (!rawTextInput && !selectedFileObject) {
        alert("Action Required: Please drag a source file or provide transaction text log copy first.");
        return;
    }

    // Set visualization loaders inside target view grids
    jsonPane.textContent = "// Instantiating cognitive normalization pass...";
    draftPane.textContent = "Writing your brand-tailored outreach copy. Please hold for engine loops...";
    draftPane.style.color = "var(--muted)";

    // Compile multi-part form payloads to match our new Multer endpoint wrappers
    const executionFormData = new FormData();
    if (selectedFileObject) {
        executionFormData.append('mediaFile', selectedFileObject);
    }
    if (rawTextInput) {
        executionFormData.append('rawText', rawTextInput);
    }

    try {
        console.log("📡 Shipping structured Form Data packet straight to /api/v1/webhook/ingest gateway wrapper...");
        
        const networkResponse = await fetch('/api/v1/webhook/ingest', {
            method: 'POST',
            headers: {
                'x-source-channel': 'web-command-center'
            },
            body: executionFormData // Browser automatically applies system multi-part boundaries
        });

        const dataTelemetry = await networkResponse.json();

        if (dataTelemetry.success && dataTelemetry.profile) {
            console.log("🎉 Network transmission completed smoothly. Parsing telemetry results back onto panels.");
            
            // Map structured metrics seamlessly back onto view windows
            jsonPane.textContent = JSON.stringify(dataTelemetry.profile, null, 2);
            
            // Render the response generated natively by writer.js
            draftPane.textContent = dataTelemetry.profile.summary || "Outreach copy asset successfully generated and archived to ledger frameworks.";
            draftPane.style.color = "var(--text)";
            
            // Update performance cockpit metrics arrays on the fly
            incrementAnalyticsCounters(dataTelemetry.profile.priority);
            
            // Flush temporary input fields cleanly
            resetIngressInputControls();
        } else {
            jsonPane.textContent = `// Execution Aborted:\n${dataTelemetry.error || 'Unknown Pipeline Failure'}`;
            draftPane.textContent = "Error encountered during context generation passes.";
            draftPane.style.color = "var(--danger)";
        }

    } catch (networkError) {
        console.error("🚨 Ingestion Pipeline Route Blocked:", networkError);
        jsonPane.textContent = `// Network Transport Layer Blocked:\n${networkError.message}`;
        draftPane.textContent = "Connection refused by target runtime server environment loops.";
        draftPane.style.color = "var(--danger)";
    }
}

function incrementAnalyticsCounters(priorityRank) {
    const ingestField = document.getElementById('m-ingested');
    const sqlField = document.getElementById('m-sql');
    
    if (ingestField) {
        let currentCount = parseInt(ingestField.textContent.replace(/,/g, ''));
        ingestField.textContent = (currentCount + 1).toLocaleString();
    }
    
    if (priorityRank === 'HIGH' && sqlField) {
        let currentSql = parseInt(sqlField.textContent.replace(/,/g, ''));
        sqlField.textContent = (currentSql + 1).toLocaleString();
    }
}

function resetIngressInputControls() {
    selectedFileObject = null;
    const fileInput = document.getElementById('mediaFile');
    if (fileInput) fileInput.value = '';
    
    const dropZoneText = document.getElementById('dropZoneText');
    if (dropZoneText) dropZoneText.textContent = "Drag & drop raw files here";
    
    document.getElementById('ui-raw-input').value = '';
}