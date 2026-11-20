<h1 align="center">Astral</h1>

<p align="center">Клиент для Windows</p>

## Downloads

### Desktop

| Платформа | Установщик |
| --- | --- |
| Windows (x64) | [Setup](https://github.com/ressedich/astral/releases/download/v1.0.2/Astral-Setup-1.0.2.exe) |

Windows 10 и 11. В установщике можно добавить Astral на рабочий стол и в меню «Пуск» — обе галочки уже включены.

Настройки и подписки не сбрасываются при обновлении. Новая версия скачивается сама: **Настройки → Система**.

## Как выложить новую версию

Соберите установщик локально и прикрепите к релизу три файла. Номер релиза должен совпадать с версией сборки. Затем поменяйте ссылку Setup в этой таблице.

```powershell
gh release create v1.0.3 release/Astral-Setup-1.0.3.exe release/Astral-Setup-1.0.3.exe.blockmap release/latest.yml --title "Astral 1.0.3" --repo ressedich/astral
```

Релиз должен открываться без входа в GitHub, иначе установленное приложение не сможет его скачать.
