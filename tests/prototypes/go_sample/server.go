// Go server fixture with router-style methods and startup entrypoint.

package main

type Server struct {
    addr string
}

func NewServer(addr string) *Server {
    return &Server{addr: addr}
}

func (server *Server) Start() error {
    return nil
}

func bootstrap(addr string) error {
    return NewServer(addr).Start()
}