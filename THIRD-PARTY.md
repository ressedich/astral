# Сторонние компоненты

Установщик Astral для Windows содержит сторонние программы. Их лицензии и тексты
находятся рядом с файлами в папке `bin` установленного приложения.

| Компонент | Версия | Назначение | Лицензия |
| --- | --- | --- | --- |
| Xray-core (`xray.exe`, `geoip.dat`, `geosite.dat`) | 26.11.9 | Прокси-ядро | MPL-2.0 |
| sing-box (`sing-box.exe`, `libcronet.dll`) | 1.14.4 | Резервное ядро | GPL-3.0 |
| Wintun (`wintun.dll`) | 0.14.1 | Драйвер TUN для Windows | GPL-2.0, см. `LICENSE-Wintun` |
| Electron / Chromium | 45.x | Оболочка приложения | MIT / BSD-3-Clause |
| React, React DOM | 19.x | Интерфейс | MIT |
| three.js, @react-three/fiber | 0.187 / 9.x | 3D-сцена | MIT |
| Cormorant Garamond, Manrope, Unbounded | — | Шрифты | SIL Open Font License 1.1 |

Оригиналы лицензий:
- Xray-core: https://github.com/XTLS/Xray-core/blob/main/LICENSE
- sing-box: https://github.com/SagerNet/sing-box/blob/dev-next/LICENSE
- Wintun: https://git.zx2c4.com/wintun/plain/LICENSE.txt
- Electron: https://github.com/electron/electron/blob/main/LICENSE
- Шрифты (OFL 1.1): папка `licenses` рядом с этим файлом

sing-box распространяется по GPL-3.0. Исходный код sing-box доступен по адресу
https://github.com/SagerNet/sing-box. Полный текст лицензии — в файле
`bin/LICENSE-sing-box` (если он есть) или в репозитории проекта.
