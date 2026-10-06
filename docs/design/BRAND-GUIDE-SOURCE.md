---
version: alpha
name: Insurvas
slug: insurvas
source: "Manual de Marca Insurvas 2026"
extractedAt: "2026-10-01"
description: "Plataforma de software inteligente para el sector asegurador. Combina el verde brillante de acción con tonos profundos de verde oliva e ink, tipografía limpia y modularidad orientada a tecnología, velocidad y confianza."

colors:
  primary: "#07d6a0"
  accent: "#07d6a0"
  accentHover: "#08bf8b"
  accentPressed: "#008769"
  ink: "#0d4037"
  body: "#33383F"
  muted: "#60646C"
  canvas: "#FCFCFD"
  surface: "#FFFFFF"
  surfaceAlt: "#F6F7F9"
  border: "#E6E8EB"
  borderStrong: "#C9CDD2"
  link: "#0d4037"
  success: "#138A43"
  warning: "#B35C00"
  error: "#C92A2A"
  bright-green: "#07d6a0"
  deep-olive: "#0d4037"
  mid-green: "#0a8769"
  dark-neutral: "#050505"
  soft-green-surface: "#c5ffed"
  footerBg: "#0d4037"
  developerBg: "#FAFAFA"
  on-primary: "#0d4037"
  on-dark: "#FCFCFD"

typography:
  display:
    fontFamily: "Coolvetica, 'Montserrat', system-ui, -apple-system, sans-serif"
    fontSize: 72px
    fontWeight: 600
    lineHeight: 0.96
    letterSpacing: "-0.04em"
  hero:
    fontFamily: "'Montserrat', system-ui, -apple-system, sans-serif"
    fontSize: 56px
    fontWeight: 600
    lineHeight: 1.02
    letterSpacing: "-0.035em"
  headline-lg:
    fontFamily: "'Montserrat', system-ui, -apple-system, sans-serif"
    fontSize: 40px
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.03em"
  title-lg:
    fontFamily: "'Montserrat', system-ui, -apple-system, sans-serif"
    fontSize: 32px
    fontWeight: 600
    lineHeight: 1.13
    letterSpacing: "-0.025em"
  title-md:
    fontFamily: "'Montserrat', system-ui, -apple-system, sans-serif"
    fontSize: 24px
    fontWeight: 600
    lineHeight: 1.21
    letterSpacing: "-0.02em"
  title-sm:
    fontFamily: "'Montserrat', system-ui, -apple-system, sans-serif"
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.28
    letterSpacing: "-0.015em"
  label:
    fontFamily: "'Montserrat', system-ui, -apple-system, sans-serif"
    fontSize: 12px
    fontWeight: 600
    lineHeight: 1.33
    letterSpacing: "0.02em"
    textTransform: uppercase
  button:
    fontFamily: "'Montserrat', system-ui, -apple-system, sans-serif"
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.43
    letterSpacing: "-0.01em"
  body:
    fontFamily: "'Montserrat', system-ui, -apple-system, sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-0.02em"
  caption:
    fontFamily: "'Montserrat', system-ui, -apple-system, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-0.02em"
  legal:
    fontFamily: "'Montserrat', system-ui, -apple-system, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-0.01em"
  pricing-display:
    fontFamily: "'Montserrat', system-ui, -apple-system, sans-serif"
    fontSize: 32px
    fontWeight: 600
    lineHeight: 1.13
    letterSpacing: "-0.025em"
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.54
    letterSpacing: "0em"

rounded:
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
  pill: 9999px

spacing:
  xs: 8px
  sm: 16px
  md: 24px
  lg: 32px
  xl: 80px
  section: 120px

components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: 12px 20px
  button-primary-active:
    backgroundColor: "{colors.accentHover}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    borderColor: "{colors.border}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: 12px 20px
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: 10px 12px
  button-link-arrow:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: 0px 0px
  nav-shell:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    height: 72px
    padding: 0px 32px
  announcement-bar:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-dark}"
    typography: "{typography.caption}"
    padding: 8px 16px
  hero-media:
    backgroundColor: "{colors.surfaceAlt}"
    rounded: "{rounded.lg}"
    overflow: hidden
  feature-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: 32px
    shadowHover: "0px 4px 16px rgba(7, 214, 160, 0.15)"
  editorial-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: 0px
  pricing-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    borderColor: "{colors.border}"
    rounded: "{rounded.lg}"
    padding: 32px
  metric-panel:
    backgroundColor: "{colors.surfaceAlt}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: 32px
  product-screenshot-panel:
    backgroundColor: "{colors.surfaceAlt}"
    rounded: "{rounded.lg}"
    padding: 24px
  input-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.body}"
    borderColor: "{colors.borderStrong}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 12px 14px
  search-command:
    backgroundColor: "{colors.surfaceAlt}"
    textColor: "{colors.muted}"
    borderColor: "{colors.border}"
    typography: "{typography.caption}"
    rounded: "{rounded.md}"
    padding: 8px 12px
  footer:
    backgroundColor: "{colors.footerBg}"
    textColor: "{colors.on-dark}"
    typography: "{typography.caption}"
    padding: 80px 32px
---

**Overview**

Insurvas proyecta la esencia de un software moderno e integral para el sector asegurador[cite: 2]. Su propuesta visual combina la frescura, tecnología y crecimiento representados por su paleta de verdes con la solidez y confianza del verde profundo (ink `#0d4037`)[cite: 2]. El concepto central de la marca es la "Data Highway" (Autopista de Datos)[cite: 2], que simboliza velocidad, transmisión en tiempo real y confiabilidad[cite: 2].

El isotipo fusiona las letras "I" y "V" en una sola estructura fluida con líneas inclinadas que evocan dynamismo[cite: 2] y una forma final de checkmark que refuerza la precisión[cite: 2].

El sitio web se organiza bajo tres enfoques principales:
1. **Modo Institucional/Marketing:** Presentaciones claras con titulares limpios, tarjetas modulares blancas y botones de acción en verde brillante (`#07d6a0`)[cite: 2].
2. **Modo Producto/Plataforma:** Orientado a dashboards de seguros, capturas de interfaz, métricas de retención, pólizas y gestión en tiempo real[cite: 2].
3. **Modo Desarrollador/Documentación:** Estructura técnica de alta legibilidad, bloques de código monospace y controles limpios[cite: 2].

Características Clave:

- Tipografía dominada por Montserrat para una jerarquía web consistente y ordenada, reservando Coolvetica para encabezados Display con personalidad[cite: 2].
- Verde brillante (`#07d6a0`) reservado para acciones clave, estado activo, indicadores inteligentes e isotipo[cite: 2].
- Verde oscuro (`#0d4037`) como color principal de contraste, barras superiores, encabezados y pie de página[cite: 2].
- Tarjetas modulares sobre fondos neutros claros (`#FCFCFD` y `#F6F7F9`) con bordes suaves[cite: 2].

**Colors**

Principales y de Acción:

`{colors.primary}` (`#07d6a0`) es el verde brillante insignia de Insurvas[cite: 2]. Utilízalo para llamadas a la acción principales (CTA), iconos activos, toggles y elementos que indiquen inteligencia o velocidad de datos[cite: 2].

`{colors.accentHover}` (`#08bf8b`) representa el estado hover del botón primario, manteniendo la viveza del verde con un toque más saturado.

`{colors.accentPressed}` (`#008769`) es el todo de presión/click y el tono medio de la paleta institucional[cite: 2].

Superficies y Fondos:

`{colors.canvas}` (`#FCFCFD`) es la base de la página, un blanco cálido y limpio.

`{colors.surface}` (`#FFFFFF`) es el fondo blanco puro para tarjetas, formularios y navegación.

`{colors.surfaceAlt}` (`#F6F7F9`) se usa en paneles de producto, gráficos de analíticas y fondos de secciones secundarias[cite: 2].

`{colors.soft-green-surface}` (`#c5ffed`) es un tono verde suave para insignias de estado activo, badges de IA o alertas del sistema.

Texto y Neutros:

`{colors.ink}` (`#0d4037`) es el verde oliva profundo utilizado para titulares, barra de navegación superior y footer[cite: 2].

`{colors.body}` (`#33383F`) para el cuerpo de texto principal[cite: 2].

`{colors.muted}` (`#60646C`) para subtítulos, etiquetas secundarias y textos descriptivos[cite: 2].

`{colors.border}` (`#E6E8EB`) y `{colors.borderStrong}` (`#C9CDD2`) definen los límites funcionales de los módulos.

Semánticos:

`{colors.success}` (`#138A43`) para estados aprobados y pólizas verificadas.

`{colors.warning}` (`#B35C00`) para revisiones pendientes o estados de alerta.

`{colors.error}` (`#C92A2A`) para bloqueos, documentos faltantes o rechazos.

**Typography**

Insurvas utiliza **Montserrat** como su familia tipográfica principal para todo el cuerpo web y la jerarquía de interfaz[cite: 2], garantizando legibilidad y profesionalismo[cite: 2]. Se incluye **Coolvetica** exclusivamente en el nivel `{typography.display}` para declaraciones o banners especiales de marca[cite: 2].

| Nivel | Tamaño | Peso | Line Height | Letter Spacing | Fuente | Uso |
|---|---:|---:|---:|---:|---|---|
| `{typography.display}` | 72px | 600 | 0.96 | -0.04em | Coolvetica | Banners principales de campaña[cite: 2] |
| `{typography.hero}` | 56px | 600 | 1.02 | -0.035em | Montserrat | Titular principal del Hero[cite: 2] |
| `{typography.headline-lg}` | 40px | 600 | 1.08 | -0.03em | Montserrat | Encabezados de sección[cite: 2] |
| `{typography.title-lg}` | 32px | 600 | 1.13 | -0.025em | Montserrat | Módulos destacados o planes de precio[cite: 2] |
| `{typography.title-md}` | 24px | 600 | 1.21 | -0.02em | Montserrat | Títulos de tarjetas de características[cite: 2] |
| `{typography.title-sm}` | 18px | 600 | 1.28 | -0.015em | Montserrat | Submódulos y paneles compactos[cite: 2] |
| `{typography.label}` | 12px | 600 | 1.33 | 0.02em | Montserrat | Etiquetas en mayúsculas (Eyebrows)[cite: 2] |
| `{typography.button}` | 14px | 600 | 1.43 | -0.01em | Montserrat | Botones y enlaces de navegación[cite: 2] |
| `{typography.body}` | 16px | 400 | 1.5 | -0.02em | Montserrat | Texto de párrafo y explicaciones[cite: 2] |
| `{typography.caption}` | 14px | 400 | 1.5 | -0.02em | Montserrat | Metadatos y pie de foto[cite: 2] |
| `{typography.legal}` | 12px | 400 | 1.5 | -0.01em | Montserrat | Términos legales y notas |
| `{typography.pricing-display}` | 32px | 600 | 1.13 | -0.025em | Montserrat | Cifras y tarifas de planes[cite: 2] |
| `{typography.code}` | 13px | 400 | 1.54 | 0em | Monospace | Fragmentos de API y consola |

**Layout & Spacing**

El sistema de espaciado se basa en una cuadrícula de 8px:
- Margen en módulos: `{spacing.xs}` (8px), `{spacing.sm}` (16px), `{spacing.md}` (24px), `{spacing.lg}` (32px).
- Espaciado entre secciones principales: `{spacing.section}` (120px).
- Ancho máximo de contenido centrado: `1200px` – `1280px`.

**Components**

- **Botón Primario:** Relleno con `{colors.primary}` (`#07d6a0`) y texto en `{colors.ink}` (`#0d4037`) para garantizar el máximo contraste y accesibilidad. Bordes completamente redondeados (`pill`).
- **Botón Secundario:** Fondo blanco (`#FFFFFF`), borde `{colors.border}` y texto `{colors.ink}`.
- **Tarjetas de Funcionalidades:** Fondo blanco con padding de 32px, esquinas redondeadas a 12px (`{rounded.lg}`) y sombra tenue al pasar el cursor (`0px 4px 16px rgba(7, 214, 160, 0.15)`).
- **Barra de Anuncios / Nav:** La barra superior utiliza el verde profundo `{colors.ink}` (`#0d4037`) para enmarcar el sitio, mientras que la navegación principal flota sobre blanco.
- **Pie de Página (Footer):** Fondo en verde profundo `{colors.footerBg}` (`#0d4037`) con texto en blanco/verde claro.

**Do's and Don'ts**

**Do:**
- Utilizar el verde brillante (`#07d6a0`) para resaltar los puntos de conversión clave y el isotipo de la marca[cite: 2].
- Mantener los encabezados en Montserrat con tracking negativo para un acabado limpio y corporativo[cite: 2].
- Utilizar el isotipo ("Data Highway") en fondos claros u oscuros siempre asegurando alto contraste[cite: 2].

**Don't:**
- No inundar fondos enteros con el verde brillante; debe usarse como color de acento y acción[cite: 2].
- No alterar la proporción de la curva/flecha del logotipo de Insurvas[cite: 2].
- No usar combinaciones de texto verde claro sobre blanco que violen los estándares de accesibilidad WCAG.