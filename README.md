# Futura Rio · Landing page + CRM de leads

Landing page da **Futura Rio Corretora de Planos de Saúde e Odontológico** (corretora responsável: **Carla Jansen**), feita para tráfego pago e SEO, com:

- Botão de WhatsApp (cabeçalho, flutuante e em todas as seções) que abre um **popup** pedindo **nome, telefone e e-mail**. O lead é salvo e a pessoa segue para o WhatsApp da Carla, **(21) 98379-9691**, com a mensagem já escrita.
- Formulário de cotação no final da página (com tipo de plano e número de vidas).
- **CRM em `/admin`** protegido por senha: lista de leads, status do funil (Novo, Em contato, Cotação enviada, Negociando, Fechado, Perdido), notas, busca, filtros, números do painel, botão para chamar o lead no WhatsApp e exportação em CSV (abre no Excel).
- Origem de cada lead registrada: `utm_source`, `utm_campaign`, `gclid` (Google Ads) e `fbclid` (Meta Ads). Assim você sabe qual campanha gerou cada contato.
- SEO: title e description otimizados, dados estruturados (InsuranceAgency, Person, FAQPage), seção de perguntas frequentes, seção de bairros atendidos, `robots.txt` e `sitemap.xml`.
- Evento **Lead** disparado no Meta Pixel e no Google Ads/GA4 quando os códigos estiverem instalados.
- Roda no **Cloudflare** (Worker + KV) ou em servidor Node.js **sem dependências** (VPS, Render, Railway, Docker).

## Publicar no Cloudflare (Worker "futurario")

Já está configurado no `wrangler.toml`: a página em `public/`, a API em `worker.js` e os leads no KV `futura-rio-leads` (binding `LEADS`). Cada push no `main` faz o deploy automaticamente.

Única configuração manual, em **Workers & Pages → futurario → Settings → Variables and Secrets** (tipo *Secret*):
- `ADMIN_PASSWORD`: senha do painel
- `SESSION_SECRET`: texto aleatório longo

Painel: `https://SEU-DOMINIO/admin`.

Teste local com o simulador do Cloudflare:

```bash
npx wrangler dev --var ADMIN_PASSWORD:teste --var SESSION_SECRET:abc
```

## Rodar em servidor Node (VPS, Render, Railway, Docker)

```bash
cp .env.example .env     # defina ADMIN_PASSWORD e SESSION_SECRET
npm start                # http://localhost:3000   painel: http://localhost:3000/admin
```

Com Docker:

```bash
docker build -t futura-rio .
docker run -d -p 3000:3000 -e ADMIN_PASSWORD='sua-senha' -e SESSION_SECRET='texto-longo' -e COOKIE_SECURE=true -v futura-data:/data futura-rio
```

Os leads ficam em `DATA_DIR/leads.json`. Use uma pasta/volume **persistente** e faça backup (ou exporte o CSV pelo painel).

## Checklist antes de ligar o tráfego

| O que | Onde |
|---|---|
| Foto profissional da Carla (substituir `carla-jansen.jpg`/`.webp`, 700×843) | `public/img/` |
| Cores: azul #2B4C7F, azul profundo #0B386F, laranja #FE6E25 | `public/css/style.css` |
| Logo (versão em alta resolução, PNG ou SVG) | `public/img/logo-futura-rio.png` |

| Novos depoimentos do Google | `public/index.html`, seção `#depoimentos` |

| Registro SUSEP (CNPJ já incluído) | rodapé do `public/index.html` |
| Domínio definitivo | `canonical`, `og:*`, JSON-LD, `robots.txt` e `sitemap.xml` (hoje `www.futurario.com.br`) |

| Meta Pixel / Google Ads / GA4 | bloco comentado no `<head>` do `public/index.html` |
| Senha do painel | `.env`, `ADMIN_PASSWORD` |
| HTTPS ativo | `COOKIE_SECURE=true` |

Depois de publicar, cadastre o site no **Google Search Console**, envie o `sitemap.xml` e coloque o link do site nas duas fichas do Google (Futura Rio e Carla Jansen).
