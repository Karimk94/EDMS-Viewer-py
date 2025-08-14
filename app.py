from flask import Flask, render_template, request, jsonify, Response, send_from_directory
import math
from edms_connector import EDMSConnector
from werkzeug.serving import run_simple

# --- Initialization ---
app = Flask(__name__, template_folder='templates', static_folder='static')
edms = EDMSConnector()

# --- HTML Route ---
@app.route('/')
def index():
    return render_template('index.html')

# --- API Routes ---
@app.route('/api/documents')
def api_get_documents():
    page = request.args.get('page', 1, type=int)
    search_term = request.args.get('search', None, type=str)
    documents, total_rows = edms.fetch_documents_from_oracle(page=page, search_term=search_term)
    total_pages = math.ceil(total_rows / 10) if total_rows > 0 else 1
    return jsonify({
        "documents": documents, "page": page,
        "total_pages": total_pages, "total_documents": total_rows
    })

@app.route('/api/image/<doc_id>')
def api_get_image(doc_id):
    image_bytes = edms.get_image_from_edms(doc_id)
    if image_bytes:
        return Response(image_bytes, mimetype='image/jpeg')
    return jsonify({'error': 'Image not found in EDMS.'}), 404

@app.route('/cache/<path:filename>')
def serve_cached_thumbnail(filename):
    return send_from_directory(edms.thumbnail_cache_dir, filename)

@app.route('/api/clear_cache', methods=['POST'])
def api_clear_cache():
    try:
        edms.clear_thumbnail_cache()
        return jsonify({"message": "Thumbnail cache cleared successfully."})
    except Exception as e:
        return jsonify({"error": f"Failed to clear cache: {e}"}), 500

@app.route('/api/update_abstract', methods=['POST'])
def api_update_abstract():
    data = request.get_json()
    doc_id = data.get('doc_id')
    names = data.get('names')
    if not doc_id or not isinstance(names, list):
        return jsonify({'error': 'Invalid data provided.'}), 400
    success, message = edms.update_abstract_with_vips(doc_id, names)
    if success:
        return jsonify({'message': message})
    else:
        return jsonify({'error': message}), 500
    
if __name__ == '__main__':
    run_simple(
        '127.0.0.1',
        5000,
        app,
        use_reloader=False,
        use_debugger=True,
        threaded=True,
        exclude_patterns=['*thumbnail_cache*', '*__pycache__*', '*venv*']
    )
