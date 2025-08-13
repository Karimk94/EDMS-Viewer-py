document.addEventListener('DOMContentLoaded', () => {
    // --- Constants ---
    const FACE_SERVICE_URL = 'http://127.0.0.1:5002'; // URL of the Face Recognition Service

    // --- DOM Elements ---
    const documentsList = document.getElementById('documents-list');
    const documentsLoader = document.getElementById('documents-loader');
    const paginationControls = document.getElementById('pagination-controls');
    const searchInput = document.getElementById('search-input');
    const searchButton = document.getElementById('search-button');
    const clearCacheBtn = document.getElementById('clear-cache-btn');
    const modal = document.getElementById('image-modal');
    const modalCloseBtn = document.getElementById('modal-close');
    const modalDocTitle = document.getElementById('modal-doc-title');
    const modalImage = document.getElementById('modal-image');
    const modalImageLoader = document.getElementById('modal-image-loader');
    const analyzeBtn = document.getElementById('analyze-btn');
    const modalImageView = document.getElementById('modal-image-view');
    const modalAnalysisView = document.getElementById('modal-analysis-view');
    const analysisResultImage = document.getElementById('analysis-result-image');
    const unknownFacesContainer = document.getElementById('unknown-faces-container');
    const updateAbstractContainer = document.getElementById('update-abstract-container');
    const updateAbstractBtn = document.getElementById('update-abstract-btn');

    // --- State Management ---
    let currentDocId = null;
    let originalImageForAnalysis = null;
    let currentSearchTerm = '';

    // --- Functions ---

    const loadDocuments = async (page = 1, searchTerm = '') => {
        documentsLoader.classList.remove('hidden');
        documentsList.innerHTML = '';
        paginationControls.innerHTML = '';
        currentSearchTerm = searchTerm;

        try {
            const url = new URL('/api/documents', window.location.origin);
            url.searchParams.append('page', page);
            if (searchTerm) url.searchParams.append('search', searchTerm);
            const response = await fetch(url);
            const data = await response.json();

            if (data.documents.length === 0) {
                documentsList.innerHTML = `<p>No documents found.</p>`;
                return;
            }

            data.documents.forEach(doc => {
                const item = document.createElement('div');
                item.className = 'document-item';
                item.dataset.docId = doc.doc_id;
                const placeholderUrl = 'https://placehold.co/100x100/e9ecef/6c757d?text=Error';
                item.innerHTML = `
                    <img src="${doc.thumbnail_url}" class="doc-thumbnail" alt="Thumbnail" onerror="this.onerror=null;this.src='${placeholderUrl}';">
                    <div class="doc-info">
                        <h3>${doc.title} (ID: ${doc.doc_id})</h3>
                        <div class="doc-meta">
                            <span>By: ${doc.author}</span> | <span>Date: ${doc.date}</span>
                        </div>
                    </div>
                    <span class="view-btn">View Image &rarr;</span>
                `;
                documentsList.appendChild(item);
            });
            renderPagination(data.page, data.total_pages);
        } catch (error) {
            documentsList.innerHTML = '<p class="error">Could not load documents.</p>';
        } finally {
            documentsLoader.classList.add('hidden');
        }
    };

    const renderPagination = (page, totalPages) => {
        paginationControls.innerHTML = '';
        if (totalPages <= 1) return;
        const createBtn = (text, targetPage, disabled) => {
            const btn = document.createElement('button');
            btn.textContent = text;
            btn.className = 'page-btn';
            btn.disabled = disabled;
            btn.addEventListener('click', () => loadDocuments(targetPage, currentSearchTerm));
            return btn;
        };
        paginationControls.appendChild(createBtn('« First', 1, page <= 1));
        paginationControls.appendChild(createBtn('‹ Prev', page - 1, page <= 1));
        const pageInfo = document.createElement('span');
        pageInfo.id = 'page-info';
        pageInfo.textContent = `Page `;
        const pageInput = document.createElement('input');
        pageInput.type = 'number';
        pageInput.id = 'page-input';
        pageInput.value = page;
        pageInput.min = 1;
        pageInput.max = totalPages;
        pageInput.addEventListener('change', (e) => {
            const newPage = parseInt(e.target.value);
            if (newPage >= 1 && newPage <= totalPages) loadDocuments(newPage, currentSearchTerm);
        });
        pageInfo.appendChild(pageInput);
        pageInfo.append(` of ${totalPages}`);
        paginationControls.appendChild(pageInfo);
        paginationControls.appendChild(createBtn('Next ›', page + 1, page >= totalPages));
        paginationControls.appendChild(createBtn('Last »', totalPages, page >= totalPages));
    };

    const openImageModal = async (docId, docTitle) => {
        currentDocId = docId;
        modal.classList.remove('hidden');
        modalDocTitle.textContent = docTitle;
        modalImageView.classList.remove('hidden');
        modalAnalysisView.classList.add('hidden');
        modalImage.classList.add('hidden');
        analyzeBtn.classList.add('hidden');
        modalImageLoader.classList.remove('hidden');
        updateAbstractContainer.classList.add('hidden');

        try {
            const response = await fetch(`/api/image/${docId}`);
            if (!response.ok) throw new Error('Image not found in EDMS.');
            const imageBlob = await response.blob();
            originalImageForAnalysis = imageBlob;
            modalImage.src = URL.createObjectURL(imageBlob);
            modalImage.onload = () => {
                modalImageLoader.classList.add('hidden');
                modalImage.classList.remove('hidden');
                analyzeBtn.classList.remove('hidden');
            };
        } catch (error) {
            modalImageLoader.classList.add('hidden');
            modalDocTitle.textContent = `Error: ${error.message}`;
        }
    };

    const closeImageModal = () => {
        modal.classList.add('hidden');
        if (modalImage.src) URL.revokeObjectURL(modalImage.src);
    };

    const performSearch = () => loadDocuments(1, searchInput.value.trim());
    searchButton.addEventListener('click', performSearch);
    searchInput.addEventListener('keyup', (e) => { if (e.key === 'Enter') performSearch(); });

    clearCacheBtn.addEventListener('click', async () => {
        if (!confirm('Are you sure you want to clear the thumbnail cache?')) return;
        try {
            const response = await fetch('/api/clear_cache', { method: 'POST' });
            const data = await response.json();
            alert(data.message || data.error);
            loadDocuments(1, currentSearchTerm);
        } catch (error) {
            alert('Failed to clear cache.');
        }
    });

    documentsList.addEventListener('click', (e) => {
        const item = e.target.closest('.document-item');
        if (item) openImageModal(item.dataset.docId, item.querySelector('h3').textContent);
    });

    analyzeBtn.addEventListener('click', async () => {
        if (!originalImageForAnalysis) return;
        analyzeBtn.disabled = true;
        analyzeBtn.textContent = 'Analyzing...';
        const formData = new FormData();
        formData.append('image_file', originalImageForAnalysis, `${currentDocId}.jpg`);
        try {
            const response = await fetch(`${FACE_SERVICE_URL}/api/analyze_image`, { method: 'POST', body: formData });
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || 'Analysis failed.');
            }
            const data = await response.json();
            modalImageView.classList.add('hidden');
            modalAnalysisView.classList.remove('hidden');
            analysisResultImage.src = `data:image/jpeg;base64,${data.processed_image}`;
            unknownFacesContainer.innerHTML = '';
            if (data.faces && data.faces.length > 0) {
                const title = document.createElement('h3');
                title.textContent = 'Detected Faces (Edit or Add Name)';
                unknownFacesContainer.appendChild(title);
                data.faces.forEach((face) => {
                    unknownFacesContainer.appendChild(createFaceForm(face, data.original_image_b64));
                });
                updateAbstractContainer.classList.remove('hidden');
            } else {
                unknownFacesContainer.innerHTML = '<p>No faces were detected in this image.</p>';
                updateAbstractContainer.classList.add('hidden');
            }
        } catch (error) {
            alert(`Error communicating with Face Service: ${error.message}`);
        } finally {
            analyzeBtn.disabled = false;
            analyzeBtn.textContent = 'Analyze for Faces';
        }
    });

    const createFaceForm = (face, originalImageB64) => {
        const formContainer = document.createElement('div');
        formContainer.className = 'face-form';
        const label = document.createElement('label');
        label.className = 'face-label';
        label.textContent = `Face #${face.index}`;
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.placeholder = 'Enter or correct name...';
        nameInput.className = 'name-input';
        if (face.name !== 'Unknown') {
            nameInput.value = face.name.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
        }
        const saveBtn = document.createElement('button');
        saveBtn.textContent = 'Save';
        saveBtn.className = 'save-btn';
        formContainer.append(label, nameInput, saveBtn);
        saveBtn.addEventListener('click', async () => {
            const name = nameInput.value.trim();
            if (!name) return alert('Please enter a name.');
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving...';
            try {
                const response = await fetch(`${FACE_SERVICE_URL}/api/add_face`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, location: face.location, original_image_b64: originalImageB64 }),
                });
                if (!response.ok) throw new Error('Failed to save face.');
                formContainer.innerHTML = `<p class="success">✅ Saved ${name}!</p>`;
            } catch (error) {
                alert(`Error: ${error.message}`);
                saveBtn.disabled = false;
                saveBtn.textContent = 'Save';
            }
        });
        return formContainer;
    };

    updateAbstractBtn.addEventListener('click', async () => {
        const nameInputs = unknownFacesContainer.querySelectorAll('.name-input');
        const names = Array.from(nameInputs)
            .map(input => input.value.trim())
            .filter(name => name !== "" && name.toLowerCase() !== "unknown");

        if (names.length === 0) {
            alert("No confirmed names to update. Please enter names for the detected faces first.");
            return;
        }
        if (!confirm(`Are you sure you want to update the abstract with these names: ${names.join(', ')}?`)) {
            return;
        }
        updateAbstractBtn.disabled = true;
        updateAbstractBtn.textContent = "Updating Oracle...";
        try {
            const response = await fetch('/api/update_abstract', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ doc_id: currentDocId, names: names }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error);
            alert(data.message);
            updateAbstractBtn.textContent = "✅ Updated Successfully";
        } catch (error) {
            alert(`Error: ${error.message}`);
            updateAbstractBtn.disabled = false;
            updateAbstractBtn.textContent = "Update Description with Confirmed Names";
        }
    });

    modalCloseBtn.addEventListener('click', closeImageModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeImageModal(); });

    loadDocuments();
});
