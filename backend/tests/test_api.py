import os
import tempfile
import unittest
from pathlib import Path

from app import app, init_db


class RoomApiTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        os.environ["DATABASE_PATH"] = str(Path(self.tempdir.name) / "test.sqlite3")
        import app as app_module
        app_module.DATABASE_PATH = os.environ["DATABASE_PATH"]
        init_db()
        app.config["TESTING"] = True
        self.client = app.test_client()

    def tearDown(self):
        self.tempdir.cleanup()

    def test_health(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["status"], "ok")

    def test_create_and_get_room(self):
        created = self.client.post("/api/rooms", json={"title": "Test room"})
        self.assertEqual(created.status_code, 201)
        data = created.get_json()
        self.assertEqual(len(data["room_id"]), 8)
        self.assertTrue(data["host_token"])
        details = self.client.get(f'/api/rooms/{data["room_id"]}')
        self.assertEqual(details.status_code, 200)
        self.assertEqual(details.get_json()["title"], "Test room")

    def test_invalid_room_id(self):
        response = self.client.get("/api/rooms/not-valid")
        self.assertEqual(response.status_code, 400)

    def test_missing_room(self):
        response = self.client.get("/api/rooms/deadbeef")
        self.assertEqual(response.status_code, 404)


if __name__ == "__main__":
    unittest.main()
