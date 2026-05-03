# Ruby service fixture that models domain work.

class Service
  def call(name)
    normalize(name)
  end

  def normalize(name)
    name.strip.downcase
  end
end