# Service vidéo séparé (Render : service privé, Docker, Francfort).
# Node 26 + ffmpeg (Debian) + yt-dlp (version fixée, empreintes vérifiées).
# Construit depuis ce dossier (Root Directory = apps/video-worker chez Render).
#
# Image de base fixée par version ET par empreinte (digest de l'index
# multi-plateforme publié par Docker Hub le 9 septembre 2026). Pour la changer :
# README.md, « Mettre à jour ».
ARG NODE_IMAGE=node:26.8.2-trixie-slim@sha256:f7bb8247fdb16250dbec7fd0e24f091c6f5f0a29d256f3aef5816a7a369166b2

# ---- Étape 1 : yt-dlp dans un environnement Python à part (/opt/yt-dlp) ----
FROM ${NODE_IMAGE} AS ytdlp
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv \
 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt /tmp/requirements.txt
# --require-hashes : chaque paquet est refusé si son empreinte SHA-256 ne
# correspond pas à celle de requirements.txt ; --only-binary : rien n'est
# compilé pendant la construction.
RUN python3 -m venv /opt/yt-dlp \
 && /opt/yt-dlp/bin/pip install --no-cache-dir --disable-pip-version-check \
      --require-hashes --only-binary=:all: -r /tmp/requirements.txt \
 && /opt/yt-dlp/bin/python -c "import curl_cffi, yt_dlp" \
 && /opt/yt-dlp/bin/yt-dlp --ignore-config --version

# ---- Étape 2 : l'image qui tourne ----
FROM ${NODE_IMAGE}
# ffmpeg (décodage), python3 (pour yt-dlp), tini (signaux et processus
# orphelins), ca-certificates (vérification TLS par ffmpeg).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=ytdlp /opt/yt-dlp /opt/yt-dlp
RUN ln -s /opt/yt-dlp/bin/yt-dlp /usr/local/bin/yt-dlp \
 && yt-dlp --ignore-config --version \
 && ffmpeg -hide_banner -version | head -n 1

WORKDIR /app
COPY package.json ./
COPY src ./src

# Rien n'est écrit sur le disque : ni vidéo, ni image, ni cache (yt-dlp
# --no-cache-dir, ffmpeg vers des tuyaux, Python sans fichiers .pyc).
ENV NODE_ENV=production \
    PORT=10000 \
    PYTHONDONTWRITEBYTECODE=1

# Utilisateur sans droits (fourni par l'image Node, uid 1000).
USER node
EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 10000) + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/main.js"]
