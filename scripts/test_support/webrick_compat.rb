# frozen_string_literal: true

begin
  require "webrick"
rescue LoadError
  require "socket"

  module WEBrick
    class Log
      def initialize(*) = nil
    end

    class Request
      attr_reader :body, :header, :path

      def initialize(path:, headers:, body:)
        @path = path
        @header = headers
        @body = body
      end
    end

    class Response
      attr_accessor :body, :status

      def initialize
        @body = ""
        @status = 200
        @headers = {}
      end

      def []=(key, value)
        @headers[key] = value
      end

      def headers
        @headers
      end
    end

    class HTTPServer
      attr_reader :config

      def initialize(**kwargs)
        @server = TCPServer.new(kwargs.fetch(:BindAddress), kwargs.fetch(:Port))
        @config = { Port: @server.addr[1] }
        @mounts = {}
        @shutdown = false
      end

      def mount_proc(path, &block)
        @mounts[path] = block
      end

      def start
        begin
          until @shutdown
            socket = @server.accept
            handle(socket)
          end
        rescue IOError, Errno::EBADF
          nil
        end
      end

      def shutdown
        @shutdown = true
        @server.close unless @server.closed?
      end

      private

      def handle(socket)
        request_line = socket.gets
        return unless request_line

        _method, full_path, _version = request_line.split(" ", 3)
        path = full_path.to_s.split("?", 2).first
        headers = read_headers(socket)
        body = socket.read(headers.fetch("content-length", ["0"]).first.to_i).to_s
        request = Request.new(path: path, headers: headers, body: body)
        response = Response.new

        if @mounts[path]
          @mounts[path].call(request, response)
        else
          response.status = 404
          response.body = "Not found"
        end

        write_response(socket, response)
      ensure
        socket&.close
      end

      def read_headers(socket)
        headers = Hash.new { |hash, key| hash[key] = [] }
        while (line = socket.gets)
          line = line.chomp
          break if line.empty?

          key, value = line.split(":", 2)
          headers[key.downcase] << value.to_s.strip if key
        end
        headers
      end

      def write_response(socket, response)
        body = response.body.to_s
        headers = response.headers.merge(
          "Content-Length" => body.bytesize.to_s,
          "Connection" => "close"
        )
        socket.write("HTTP/1.1 #{response.status} OK\r\n")
        headers.each { |key, value| socket.write("#{key}: #{value}\r\n") }
        socket.write("\r\n")
        socket.write(body)
      end
    end
  end
end
