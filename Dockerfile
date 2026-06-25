FROM nginx:alpine

# Copy all web assets to nginx serve directory
COPY web/ /usr/share/nginx/html/

# Nginx config for SPA with import maps
RUN cat > /etc/nginx/conf.d/default.conf <<'NGINX'
server {
    listen 80;
    server_name localhost;

    root /usr/share/nginx/html;
    index index.html;

    # CORS headers for CDN textures
    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header Cross-Origin-Embedder-Policy "require-corp" always;

    # Serve index.html for all routes (SPA)
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # MIME types for ES modules
    location ~* \.js$ {
        types { application/javascript js; }
    }
}
NGINX

EXPOSE 8888
