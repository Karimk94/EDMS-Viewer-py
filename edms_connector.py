import oracledb
import os
from zeep import Client, Settings
from zeep.exceptions import Fault
from dotenv import load_dotenv
import re
from PIL import Image
import io
import shutil

load_dotenv()

class EDMSConnector:
    def __init__(self):
        self.oracle_user = os.getenv("ORACLE_USER")
        self.oracle_password = os.getenv("ORACLE_PASSWORD")
        self.oracle_dsn = os.getenv("ORACLE_DSN")
        self.wsdl_url = os.getenv("WSDL_URL")
        self.dms_user = os.getenv("DMS_USER")
        self.dms_password = os.getenv("DMS_PASSWORD")
        self.dst = None
        
        self.thumbnail_cache_dir = os.path.join(os.path.dirname(__file__), 'thumbnail_cache')
        os.makedirs(self.thumbnail_cache_dir, exist_ok=True)
        print(f"✅ Thumbnail cache is at: {self.thumbnail_cache_dir}")

    def _get_db_connection(self):
        try:
            return oracledb.connect(user=self.oracle_user, password=self.oracle_password, dsn=self.oracle_dsn)
        except oracledb.Error as e:
            print(f"❌ Oracle Database connection FAILED. Error: {e}")
            return None

    def _dms_login(self):
        if self.dst: return self.dst
        try:
            settings = Settings(strict=False, xml_huge_tree=True)
            client = Client(self.wsdl_url, settings=settings)
            login_info_type = client.get_type('{http://schemas.datacontract.org/2004/07/OpenText.DMSvr.Serializable}DMSvrLoginInfo')
            login_info_instance = login_info_type(network=0, loginContext='RTA_MAIN', username=self.dms_user, password=self.dms_password)
            array_type = client.get_type('{http://schemas.datacontract.org/2004/07/OpenText.DMSvr.Serializable}ArrayOfDMSvrLoginInfo')
            login_info_array_instance = array_type(DMSvrLoginInfo=[login_info_instance])
            response = client.service.LoginSvr5(call={'loginInfo': login_info_array_instance, 'authen': 1, 'dstIn': ''})
            if response and response.resultCode == 0 and response.DSTOut:
                self.dst = response.DSTOut
                return self.dst
            return None
        except Exception as e:
            print(f"❌ An unexpected error occurred during DMS login: {e}")
            return None

    def fetch_documents_from_oracle(self, page=1, page_size=10, search_term=None, date_from=None, date_to=None):
        conn = self._get_db_connection()
        if not conn: return [], 0
        offset = (page - 1) * page_size
        documents = []
        total_rows = 0
        
        base_where = "WHERE docnumber >= 19661457 and FORM = 2740 "
        count_query = f"SELECT COUNT(DOCNUMBER) FROM PROFILE {base_where}"
        fetch_query = f"SELECT DOCNUMBER, ABSTRACT, AUTHOR, CREATION_DATE FROM PROFILE {base_where}"
        
        where_clause = ""
        params = {}
        if search_term:
            words = re.findall(r'\w+', search_term.upper())
            conditions = [f"UPPER(ABSTRACT) LIKE :search_word_{i}" for i in range(len(words))]
            where_clause += "AND " + " AND ".join(conditions)
            for i, word in enumerate(words):
                params[f"search_word_{i}"] = f"%{word}%"
        
        if date_from:
            where_clause += " AND CREATION_DATE >= TO_DATE(:date_from, 'YYYY-MM-DD HH24:MI:SS')"
            params['date_from'] = date_from

        if date_to:
            where_clause += " AND CREATION_DATE <= TO_DATE(:date_to, 'YYYY-MM-DD HH24:MI:SS')"
            params['date_to'] = date_to

        try:
            with conn.cursor() as cursor:
                cursor.execute(count_query + where_clause, params)
                total_rows = cursor.fetchone()[0]
                params['offset'] = offset
                params['page_size'] = page_size
                cursor.execute(fetch_query + where_clause + " ORDER BY DOCNUMBER DESC OFFSET :offset ROWS FETCH NEXT :page_size ROWS ONLY", params)
                for row in cursor:
                    doc_id = row[0]
                    thumbnail_path = self.get_thumbnail_from_edms(doc_id)
                    documents.append({
                        "doc_id": doc_id, "title": row[1] or "No Title",
                        "author": row[2] or "N/A", "date": row[3].strftime('%Y-%m-%d') if row[3] else "N/A",
                        "thumbnail_url": thumbnail_path or "https://placehold.co/100x100/e9ecef/6c757d?text=No+Image"
                    })
        finally:
            conn.close()
        return documents, total_rows

    def get_image_from_edms(self, doc_number):
        """
        Retrieves a single document's full-size image bytes from the DMS.
        """
        dst = self._dms_login()
        if not dst: 
            return None
            
        svc_client, obj_client, content_id, stream_id = None, None, None, None
        try:
            settings = Settings(strict=False, xml_huge_tree=True)
            svc_client = Client(self.wsdl_url, port_name='BasicHttpBinding_IDMSvc', settings=settings)
            obj_client = Client(self.wsdl_url, port_name='BasicHttpBinding_IDMObj', settings=settings)
            
            get_doc_call = {
                'call': {
                    'dstIn': dst,
                    'criteria': {
                        'criteriaCount': 2,
                        'criteriaNames': {'string': ['%TARGET_LIBRARY', '%DOCUMENT_NUMBER']},
                        'criteriaValues': {'string': ['RTA_MAIN', str(doc_number)]}
                    }
                }
            }
            doc_reply = svc_client.service.GetDocSvr3(**get_doc_call)

            if not (doc_reply and doc_reply.resultCode == 0 and doc_reply.getDocID):
                return None
            
            content_id = doc_reply.getDocID
            stream_reply = obj_client.service.GetReadStream(call={'dstIn': dst, 'contentID': content_id})
            
            if not (stream_reply and stream_reply.resultCode == 0 and stream_reply.streamID):
                raise Exception("Failed to get read stream.")
            
            stream_id = stream_reply.streamID
            doc_buffer = bytearray()
            while True:
                read_reply = obj_client.service.ReadStream(call={'streamID': stream_id, 'requestedBytes': 65536})
                if not read_reply or read_reply.resultCode != 0: break
                chunk_data = read_reply.streamData.streamBuffer if read_reply.streamData else None
                if not chunk_data: break
                doc_buffer.extend(chunk_data)
            
            return bytes(doc_buffer)

        except Fault as e:
            print(f"DMS server fault for doc: {doc_number}. Error: {e}")
            return None
        finally:
            if obj_client:
                if stream_id:
                    try: obj_client.service.ReleaseObject(call={'objectID': stream_id})
                    except Exception: pass
                if content_id:
                    try: obj_client.service.ReleaseObject(call={'objectID': content_id})
                    except Exception: pass

    def get_thumbnail_from_edms(self, doc_number):
        thumbnail_filename = f"{doc_number}.jpg"
        cached_path = os.path.join(self.thumbnail_cache_dir, thumbnail_filename)
        if os.path.exists(cached_path):
            return f"cache/{thumbnail_filename}"
        image_bytes = self.get_image_from_edms(doc_number)
        if not image_bytes: return None
        try:
            with Image.open(io.BytesIO(image_bytes)) as img:
                img.thumbnail((100, 100))
                img.convert("RGB").save(cached_path, "JPEG")
                return f"cache/{thumbnail_filename}"
        except Exception:
            return None
            
    def clear_thumbnail_cache(self):
        folder = self.thumbnail_cache_dir
        shutil.rmtree(folder)
        os.makedirs(folder)
        
    def update_abstract_with_vips(self, doc_id, vip_names):
        conn = self._get_db_connection()
        if not conn: return False, "Could not connect to the database."
        try:
            with conn.cursor() as cursor:
                cursor.execute("SELECT ABSTRACT FROM PROFILE WHERE DOCNUMBER = :1", [doc_id])
                result = cursor.fetchone()
                if result is None: return False, f"Document with ID {doc_id} not found."
                current_abstract = result[0] or ""
                names_str = ", ".join(vip_names)
                vips_section = f" VIPs : {names_str}"
                new_abstract = current_abstract + (" " if current_abstract else "") + vips_section
                cursor.execute("UPDATE PROFILE SET ABSTRACT = :1 WHERE DOCNUMBER = :2", [new_abstract, doc_id])
                conn.commit()
                return True, "Abstract updated successfully."
        except oracledb.Error as e:
            return False, f"Database error: {e}"
        finally:
            conn.close()