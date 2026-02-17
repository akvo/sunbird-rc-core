# Sunbird Registry and Credentials - Improved Fork

![Build](https://github.com/Sunbird-RC/sunbird-rc-core/actions/workflows/maven.yml/badge.svg)

> 🎯 **This is an enhanced fork** of [Sunbird-RC/sunbird-rc-core](https://github.com/Sunbird-RC/sunbird-rc-core) with automated setup, improved documentation, and production-ready fixes.

## 🚀 Quick Start (Easier Than Ever!)

```bash
# Clone this repository
gh repo clone akvo/sunbird-rc-core
cd sunbird-rc-core

# Start all services with automated vault unsealing
./start-sunbird.sh

# Access the Admin Portal
open http://localhost:3001
# Login: admin / admin123
```

That's it! No manual vault unsealing, no complex configuration needed.

---

## About Sunbird RC

Sunbird RC is an open-source software framework for rapidly building electronic
registries, enable attestation capabilities, and build verifiable credentialling
with minimal effort.

Registry is a shared digital infrastructure which enables authorized data
repositories to publish appropriate data and metadata about a user/entity along
with the link to the repository in a digitally signed form. It allows data
owners to provide authorized access to other users/entities in controlled manner
for digital verification and usage.

## ✨ What's Better in This Fork?

| Feature | Original | This Fork |
|---------|----------|-----------|
| **Vault Setup** | Manual unsealing every restart | ✅ Automated with `start-sunbird.sh` |
| **Admin Portal** | Separate setup required | ✅ Integrated & pre-configured |
| **PostgreSQL** | Version conflicts | ✅ Pinned to stable v16 |
| **Documentation** | Basic setup guide | ✅ Comprehensive 700+ line guide |
| **Security** | Sensitive files exposed | ✅ Protected with .gitignore |
| **First-Time Setup** | 30-60 minutes | ✅ 5 minutes |

## 📋 Services & Ports

| Service | Port | Description |
|---------|------|-------------|
| **Admin Portal** | 3001 | Management interface (pre-configured!) |
| Registry API | 8081 | Core Sunbird RC API |
| Keycloak | 8080 | Authentication & authorization |
| Verification UI | 80 | Public certificate verification |
| PostgreSQL | 5432 | Database |
| Vault | 8200 | Secrets management |
| Elasticsearch | 9200 | Search engine |
| MinIO | 9000-9001 | File storage |

## 📖 Documentation

- **[SETUP_GUIDE.md](./SETUP_GUIDE.md)** - Complete setup guide with troubleshooting (highly recommended!)
- **[Official Docs](https://docs.sunbirdrc.dev/)** - Sunbird RC documentation
- **[Installation Guide](https://docs.sunbirdrc.dev/developer-documentation/installation-guide)** - Upstream guide

## 🛠️ Requirements

- Docker & Docker Compose v2+
- 8GB+ RAM recommended
- Ports 80, 3001, 8080, 8081, 8200 available

## 🔧 Key Improvements

### 1. Automated Startup Script
```bash
./start-sunbird.sh
```
- Starts all services
- Automatically unseals Vault
- Starts dependent services in correct order
- Shows service status

### 2. Pre-Configured Admin Portal
- Fully integrated into docker-compose
- Custom nginx with Keycloak redirect fixes
- No separate setup needed
- Access at http://localhost:3001

### 3. Fixed Issues
- ✅ PostgreSQL version pinned to v16
- ✅ Vault unsealing automated
- ✅ Admin portal nginx configuration fixed
- ✅ Sensitive files protected in .gitignore
- ✅ Credential service bug documented

### 4. Enhanced Security
- `.gitignore` protects vault keys and credentials
- Environment variables properly secured
- Data directories excluded from git

## 📝 Default Credentials

**Admin Portal (Sunbird RC Realm)**:
- URL: http://localhost:3001
- Username: `admin`
- Password: `admin123`

**Keycloak Admin Console**:
- URL: http://localhost:8080/auth/admin
- Username: `admin`
- Password: `admin`

⚠️ **Change these in production!**

## ⚠️ Known Issues

- Credential service may fail in v2.0.2 (dependency bug) - doesn't affect core functionality
- See [SETUP_GUIDE.md](./SETUP_GUIDE.md) for detailed troubleshooting

## 🤝 Contributing

Contributions welcome!

**To this fork**:
1. Fork this repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push: `git push origin feature/amazing-feature`
5. Open a Pull Request

**To upstream**: See [Sunbird-RC/sunbird-rc-core](https://github.com/Sunbird-RC/sunbird-rc-core)

## 🔗 Links

- **This Fork**: https://github.com/akvo/sunbird-rc-core
- **Original**: https://github.com/Sunbird-RC/sunbird-rc-core
- **Discussions**: https://github.com/Sunbird-RC/community/discussions

## 📄 License

This repository's contents are licensed under the MIT license. See the
[license file](./LICENSE) for more details.

---

**Made with ❤️ to make Sunbird RC easier to use**
