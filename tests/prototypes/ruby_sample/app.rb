# Ruby entrypoint fixture for semantic extraction.

require_relative "service"

class App
  def run(name)
    Service.new.call(name)
  end
end