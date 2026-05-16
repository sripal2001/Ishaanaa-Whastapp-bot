import pymongo
import datetime

# MongoDB URI
uri = "mongodb+srv://sripalsripal2001:Sripal7032@cluster0.p7d5s.mongodb.net/ishaanaa-pos?retryWrites=true&w=majority"

client = pymongo.MongoClient(uri)
db = client['ishaanaa-pos']
employees_col = db['employees']
attendance_col = db['attendances']

today = datetime.datetime.now().strftime('%Y-%m-%d')
employees = employees_col.find({})

count = 0
for emp in employees:
    # Check if record exists
    existing = attendance_col.find_one({"employee_id": emp['_id'], "date": today})
    if not existing:
        attendance_col.insert_one({
            "employee_id": emp['_id'],
            "date": today,
            "check_in": "10:00 AM",
            "status": "Present"
        })
        print(f"✅ Marked {emp.get('name')} as Present")
        count += 1
    else:
        print(f"ℹ️ {emp.get('name')} already has a record")

print(f"Done! Marked {count} employees.")
