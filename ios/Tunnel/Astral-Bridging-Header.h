char *AstralStart(const char *config);
void AstralStop(void);
void AstralSetInterface(const char *name);

int hev_socks5_tunnel_main_from_str(const unsigned char *config_str, unsigned int config_len, int tun_fd);
void hev_socks5_tunnel_quit(void);
