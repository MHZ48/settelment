import json
import csv

# اسم ملف JSON الخاص بك (تأكد أنه في نفس المجلد)
INPUT_FILE = 'data.json'

def main():
    # 1. فتح وقراءة ملف JSON مع دعم اللغة العربية
    try:
        with open(INPUT_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            print("✅ تم قراءة ملف data.json بنجاح.\n")
    except FileNotFoundError:
        print(f"❌ خطأ: لم يتم العثور على الملف '{INPUT_FILE}'.")
        return
    except json.JSONDecodeError:
        print(f"❌ خطأ: ملف '{INPUT_FILE}' لا يحتوي على صيغة JSON صحيحة.")
        return

    # ==========================================
    # 2. استخراج الألوان (colors.csv)
    # ==========================================
    if "vehicle_colors" in data:
        all_colors = set()
        for group in data["vehicle_colors"]:
            if "colors" in group:
                for color in group["colors"]:
                    all_colors.add(color)
                    
        with open('colors.csv', 'w', encoding='utf-8', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(['color_name'])
            for color in sorted(all_colors):
                writer.writerow([color])
        print("📁 تم إنشاء: colors.csv (جدول الألوان)")

    # ==========================================
    # 3. استخراج صفات التسجيل (registration_types.csv)
    # ==========================================
    if "registration_types" in data:
        with open('registration_types.csv', 'w', encoding='utf-8', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(['type_name'])
            for reg_type in data["registration_types"]:
                writer.writerow([reg_type])
        print("📁 تم إنشاء: registration_types.csv (جدول صفات التسجيل)")

    # ==========================================
    # 4. استخراج قطع الغيار (parts.csv)
    # ==========================================
    if "PDB" in data:
        with open('parts.csv', 'w', encoding='utf-8', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(['part_name', 'default_price'])
            for part in data["PDB"]:
                writer.writerow([part, 0])
        print("📁 تم إنشاء: parts.csv (جدول قطع الغيار)")

    # ==========================================
    # 5. استخراج بيانات السيارات (إلى جدولين منفصلين)
    # ==========================================
    if "CAR_DATA" in data:
        # تجهيز الملفين
        with open('car_makes.csv', 'w', encoding='utf-8', newline='') as f_makes, \
             open('car_models.csv', 'w', encoding='utf-8', newline='') as f_models:
            
            writer_makes = csv.writer(f_makes)
            writer_models = csv.writer(f_models)
            
            # أسماء الأعمدة 
            writer_makes.writerow(['id', 'make_name'])
            writer_models.writerow(['make_id', 'model_name'])
            
            make_id_counter = 1 # عداد يبدأ من 1
            
            for car_make, car_models in data["CAR_DATA"].items():
                # أ) كتابة نوع السيارة في ملف الماركات
                writer_makes.writerow([make_id_counter, car_make])
                
                # ب) كتابة الأصناف في ملف الموديلات وربطها برقم الماركة
                for model in car_models:
                    writer_models.writerow([make_id_counter, model])
                    
                make_id_counter += 1
                
        print("📁 تم إنشاء: car_makes.csv و car_models.csv (تم فصل البيانات باحترافية!)")

    print("\n🎉 تمت عملية التحويل بنجاح! يمكنك الآن رفع هذه الملفات الـ 5 إلى Supabase.")

if __name__ == '__main__':
    main()