# Widget Itera pentru iPad

Aceasta este o variantă Scriptable, pentru test rapid pe iPad. Nu necesită un cont Apple Developer și nu modifică aplicația web.

1. Instalează Scriptable din App Store pe iPad.
2. Creează un script nou numit `Itera Home` și copiază conținutul din `Itera Home.js`.
3. Rulează-l o singură dată în Scriptable. Introdu emailul și parola de la Itera; parola nu este salvată. Sesiunea se păstrează în Keychain-ul iPad-ului.
4. Ține apăsat pe ecranul principal al iPad-ului → `+` → Scriptable → alege un widget mediu sau mare → `Edit Widget` → selectează `Itera Home`.

Widgetul arată starea orarului și taskurile/testele zilei. O atingere deschide Itera. iPadOS stabilește momentul efectiv al actualizărilor; scriptul cere o actualizare la cel puțin 15 minute, dar nu poate promite un countdown exact.

Pentru widgeturi complet native, cu update-uri mai precise și configurare directă în iPadOS, următorul pas este o aplicație iOS SwiftUI + WidgetKit.
